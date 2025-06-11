// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title NootCards - High/Low Card Game (Offchain Gameplay Version)
 * @notice This version implements a provably fair and verifiable card sequence
 * using deterministic cryptographic randomness, user-side entropy, and hash chaining.
 * 
 * Implementation features:
 * - Dealer commits to a hash chain (final hash of a sequence of hashes)
 * - Gameplay happens offchain with backend providing hashes as player wins rounds
 * - Contract verifies each revealed hash is part of the original committed chain
 * - Card for each round is determined by combining the verified hash with user entropy
 * - Players can cash out anytime or request withdrawal if backend becomes unresponsive
 * 
 * Card Generation:
 * - Card value is derived from: keccak256(hash + userRandomNonce + playerAddress + gameId)
 * - This combined entropy prevents either party from predicting or manipulating the outcome
 * 
 * Security guarantees (VRF-like):
 * - Unbiasable randomness: dealer can't grind seeds/hashes after commitment
 * - Verifiable sequence: hash chain allows verification of card authenticity
 * - Trustless gameplay: neither side can influence randomness after the game starts
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract NootCards {
    enum Card { Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace }
    enum Guess { Higher, Lower }
    enum GameStatus { Inactive, Active, Completed }
    enum PaymentType { Token, ETH }
    
    uint8 constant public GAME_MAX_TURNS = 10;
    
    struct Game {
        address player;
        uint256 wager;
        GameStatus status;
        uint256 gameId;
        bytes32 commitment;     // Dealer's commitment (hash of the final hash in the chain)
        bytes32 userRandomNonce; // Player's random nonce
        PaymentType paymentType; // Whether the game uses Token or ETH
    }
    
    // Withdrawal request data
    struct WithdrawalRequest {
        uint256 timestamp;
        Guess lastGuess;
        bytes32 previousHash;
        uint8 finalTurn;
    }
    
    // Pending wager limit update
    struct PendingWagerUpdate {
        uint256 minWager;
        uint256 maxWager;
        uint256 minEthWager;
        uint256 maxEthWager;
        uint256 timestamp;
    }
    
    address public admin;
    address public immutable dealer;
    IERC20 public erc20Token;
    uint256 public minWager;
    uint256 public maxWager;
    uint256 public minEthWager;
    uint256 public maxEthWager;
    uint256 public immutable withdrawalTimelock = 48 hours;
    uint256 public immutable wagerLimitUpdateDelay = 24 hours;
    
    // Active games tracking
    uint256 public activeGameCount;
    uint256 public totalActiveTokenWagers;
    uint256 public totalActiveEthWagers;
    
    mapping(address => uint256) public playerGameCounters;
    mapping(address => WithdrawalRequest) public withdrawalRequests;
    mapping(address => mapping(uint256 => Game)) public playerGames;
    mapping(bytes32 => bool) public usedSponsorshipNonces;
    
    PendingWagerUpdate public pendingWagerUpdate;
    
    event GameStarted(address indexed player, uint256 gameId, uint256 wager, uint8 turns, bytes32 commitment, PaymentType paymentType, bytes32 userRandomNonce, bytes32 sponsorshipNonce);
    event GameEnded(address indexed player, uint256 gameId, uint8 turn, bool won, uint256 prize, PaymentType paymentType);
    event WithdrawalRequested(address indexed player, uint256 timestamp);
    event WithdrawalCancelled(address indexed player);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event AdminDirectWithdrawal(uint256 amount, PaymentType paymentType);
    event WagerLimitUpdateRequested(uint256 minWager, uint256 maxWager, uint256 minEthWager, uint256 maxEthWager, uint256 timestamp);
    event WagerLimitUpdateExecuted(uint256 minWager, uint256 maxWager, uint256 minEthWager, uint256 maxEthWager);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "NootCards: caller is not the admin");
        _;
    }
    
    modifier onlyDealer() {
        require(msg.sender == dealer, "NootCards: caller is not the dealer");
        _;
    }
    
    constructor(address _erc20Token, address _dealer, uint256 _minWager, uint256 _maxWager, uint256 _minEthWager, uint256 _maxEthWager) {
        require(_erc20Token != address(0), "NootCards: token address cannot be zero");
        require(_dealer != address(0), "NootCards: dealer address cannot be zero");
        
        admin = msg.sender;
        dealer = _dealer;
        erc20Token = IERC20(_erc20Token);
        minWager = _minWager;
        maxWager = _maxWager;
        minEthWager = _minEthWager;
        maxEthWager = _maxEthWager;
    }
    
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
    
    /**
     * @notice Request a wager limit update with 24-hour delay
     * @param _minWager New minimum token wager
     * @param _maxWager New maximum token wager
     * @param _minEthWager New minimum ETH wager
     * @param _maxEthWager New maximum ETH wager
     */
    function requestWagerLimitUpdate(uint256 _minWager, uint256 _maxWager, uint256 _minEthWager, uint256 _maxEthWager) external onlyAdmin {
        require(_minWager <= _maxWager, "Invalid token wager limits");
        require(_minEthWager <= _maxEthWager, "Invalid ETH wager limits");
        require(pendingWagerUpdate.timestamp == 0, "Pending wager update already exists");
        
        pendingWagerUpdate = PendingWagerUpdate({
            minWager: _minWager,
            maxWager: _maxWager,
            minEthWager: _minEthWager,
            maxEthWager: _maxEthWager,
            timestamp: block.timestamp
        });
        
        emit WagerLimitUpdateRequested(_minWager, _maxWager, _minEthWager, _maxEthWager, block.timestamp);
    }
    
    /**
     * @notice Execute the pending wager limit update after delay
     */
    function executeWagerLimitUpdate() external onlyAdmin {
        require(pendingWagerUpdate.timestamp > 0, "No pending wager update");
        require(block.timestamp >= pendingWagerUpdate.timestamp + wagerLimitUpdateDelay, "Update delay not expired");
        
        minWager = pendingWagerUpdate.minWager;
        maxWager = pendingWagerUpdate.maxWager;
        minEthWager = pendingWagerUpdate.minEthWager;
        maxEthWager = pendingWagerUpdate.maxEthWager;
        
        emit WagerLimitUpdateExecuted(minWager, maxWager, minEthWager, maxEthWager);
        
        // Clear pending update
        delete pendingWagerUpdate;
    }
    
    /**
     * @notice Cancel a pending wager limit update
     */
    function cancelWagerLimitUpdate() external onlyAdmin {
        require(pendingWagerUpdate.timestamp > 0, "No pending wager update");
        delete pendingWagerUpdate;
    }
    
    /**
     * @notice Calculate the multiplier for a specific turn
     * @param turn The turn number (1-indexed)
     * @return The multiplier value (e.g., 110 for 1.10x)
     */
    function calculateTurnMultiplier(uint8 turn) public pure returns (uint256) {
        require(turn > 0 && turn <= GAME_MAX_TURNS, "Turn must be between 1 and 10");
        
        // Starting multiplier: 1.10x (110)
        // Increment: 0.02x per turn for rounds 1-9, then 0.04x for round 10
        if (turn <= 9) {
            return 110 + ((turn - 1) * 2);
        } else {
            return 130; // Round 10: 1.30x
        }
    }
    
    // Helper to derive a card from a hash with user entropy
    function _getCardFromHash(bytes32 turnHash, bytes32 userRandomNonce, address player, uint256 gameId) internal pure returns (Card) {
        // Combine hash with user entropy
        bytes32 combinedHash = keccak256(abi.encodePacked(turnHash, userRandomNonce, player, gameId));
        
        // Use the combined hash to determine the card
        return Card(uint8(uint256(combinedHash) % 13));
    }

    // Internal helper to check win condition
    function _checkWin(Card previousCard, Card newCard, Guess guess) internal pure returns (bool) {
        if (guess == Guess.Higher) {
            return uint8(newCard) > uint8(previousCard);
        } else {
            return uint8(newCard) < uint8(previousCard);
        }
    }
    
    // Verify a commitment signature from the dealer
    function _verifyCommitmentSignature(bytes32 commitment, bytes memory signature, address userAddress, uint256 gameId) internal view returns (bool) {
        // Create message hash including user address and game ID
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(commitment, userAddress, gameId))
        ));
        
        // Recover signer from signature
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recoveredSigner = ecrecover(messageHash, v, r, s);
        
        return recoveredSigner == dealer;
    }
    
    // Verify a player's guess signature
    function _verifyGuessSignature(bytes memory signature, uint256 gameId, uint8 turn, Guess guess, address player) internal pure returns (bool) {
        // Create message hash for the guess
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(gameId, turn, uint8(guess)))
        ));
        
        // Recover signer from signature
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recoveredSigner = ecrecover(messageHash, v, r, s);
        
        return recoveredSigner == player;
    }
    
    // Helper function to split signature into r, s, v components
    function _splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "NootCards: invalid signature length");
        
        assembly {
            // first 32 bytes
            r := mload(add(sig, 32))
            // next 32 bytes
            s := mload(add(sig, 64))
            // final byte (first byte of the next 32 bytes)
            v := byte(0, mload(add(sig, 96)))
        }
        
        return (r, s, v);
    }
    
    /**
     * @notice Calculate the current pot for a game based on wager and completed turns
     * @param game The game to calculate the pot for
     * @param turn The number of completed turns
     * @return The calculated current pot value
     */
    function calculateCurrentPot(Game memory game, uint8 turn) public pure returns (uint256) {
        if (game.status != GameStatus.Active || turn == 0) {
            return 0;
        }
        
        uint256 pot = game.wager;
        // Apply multipliers for each completed turn (up to current turn)
        for (uint8 i = 1; i <= turn; i++) {
            pot = (pot * calculateTurnMultiplier(i)) / 100;
        }
        
        return pot;
    }
    
    /**
     * @notice Calculate the maximum possible pot for a game (if all turns are completed)
     * @param wager The initial wager amount
     * @return The maximum possible pot
     */
    function calculateMaxPot(uint256 wager) public pure returns (uint256) {
        uint256 pot = wager;
        
        for (uint8 i = 1; i <= GAME_MAX_TURNS; i++) {
            pot = (pot * calculateTurnMultiplier(i)) / 100;
        }
        
        return pot;
    }
    
    /**
     * @notice Internal function to start a game (common logic for both regular and sponsored games)
     */
    function _startGame(address player, uint256 wagerAmount, bytes32 userRandomNonce, bytes32 dealerCommitment,
     bytes memory commitmentSignature, PaymentType paymentType, bool isSponsored, bytes32 sponsorshipNonce) internal {
        // Check if the player has a pending withdrawal request
        require(withdrawalRequests[player].timestamp == 0, "Pending withdrawal request exists");
        
        // Ensure wager is within limits
        if (paymentType == PaymentType.Token) {
            require(wagerAmount >= minWager, "Wager too small");
            require(wagerAmount <= maxWager, "Wager too large");
        } else {
            require(wagerAmount >= minEthWager, "ETH wager too small");
            require(wagerAmount <= maxEthWager, "ETH wager too large");
        }
        
        // Generate a player-specific sequential game ID
        uint256 gameId = playerGameCounters[player];
        playerGameCounters[player]++;
        
        // Verify the commitment signature
        require(_verifyCommitmentSignature(dealerCommitment, commitmentSignature, player, gameId),
            "Invalid commitment signature");
        
        // Initialize the game
        playerGames[player][gameId] = Game({
            player: player,
            wager: wagerAmount,
            status: GameStatus.Active,
            gameId: gameId,
            commitment: dealerCommitment,
            userRandomNonce: userRandomNonce,
            paymentType: paymentType
        });
        
        // Track active game
        _updateActiveGameCounters(wagerAmount, paymentType, true);
        
        // Emit appropriate event
        emit GameStarted(player, gameId, wagerAmount, GAME_MAX_TURNS, dealerCommitment, paymentType, userRandomNonce, isSponsored ? sponsorshipNonce : bytes32(0));
    }

    /**
     * @notice Start a new game with the dealer's commitment and player's random nonce
     * @param wagerAmount The amount of tokens to wager (ignored if using ETH)
     * @param userRandomNonce The player's random nonce to be combined with the dealer's seed
     * @param dealerCommitment The dealer's commitment (hash of privateSecret)
     * @param commitmentSignature The dealer's signature of the commitment
     */
    function startGame(uint256 wagerAmount, bytes32 userRandomNonce, bytes32 dealerCommitment, bytes memory commitmentSignature) external payable {
        // Determine payment type based on whether ETH was sent
        PaymentType paymentType = msg.value > 0 ? PaymentType.ETH : PaymentType.Token;
        uint256 actualWager;
        
        if (paymentType == PaymentType.ETH) {
            // Using ETH payment
            require(wagerAmount == 0, "Cannot specify token amount when using ETH");
            actualWager = msg.value;
        } else {
            // Using token payment
            actualWager = wagerAmount;
            
            // Transfer tokens from player to contract
            require(erc20Token.transferFrom(msg.sender, address(this), actualWager), "Token transfer failed");
        }
        
        // Start the game using common logic
        _startGame(msg.sender, actualWager, userRandomNonce, dealerCommitment, 
            commitmentSignature, paymentType, false, bytes32(0));
    }

    /**
     * @notice Start a sponsored game where the dealer covers the wager
     * @param userRandomNonce The player's random nonce to be combined with the dealer's seed
     * @param dealerCommitment The dealer's commitment (hash of privateSecret)
     * @param commitmentSignature The dealer's signature of the commitment
     * @param sponsoredAmount The amount being sponsored
     * @param paymentType The type of payment being sponsored (Token or ETH)
     * @param sponsorshipNonce A unique nonce for the sponsorship to prevent replay attacks
     * @param sponsorshipSignature The dealer's signature authorizing the sponsorship
     */
    function startSponsoredGame(bytes32 userRandomNonce, bytes32 dealerCommitment, bytes memory commitmentSignature, uint256 sponsoredAmount, 
    PaymentType paymentType, bytes32 sponsorshipNonce, bytes memory sponsorshipSignature) external {
        // Ensure the nonce hasn't been used before
        require(!usedSponsorshipNonces[sponsorshipNonce], "Sponsorship nonce already used");
        
        // Verify sponsorship signature
        require(_verifySponsorshipSignature(msg.sender, sponsoredAmount, paymentType, 
            sponsorshipNonce, sponsorshipSignature), "Invalid sponsorship signature");
        
        // Mark sponsorship nonce as used
        usedSponsorshipNonces[sponsorshipNonce] = true;
        
        // Start the game using common logic
        _startGame(msg.sender, sponsoredAmount, userRandomNonce, dealerCommitment,
            commitmentSignature, paymentType, true, sponsorshipNonce);
    }
    
    // Verify a sponsorship signature from the dealer
    function _verifySponsorshipSignature(address userAddress, uint256 sponsoredAmount, PaymentType paymentType, bytes32 sponsorshipNonce, bytes memory signature) internal view returns (bool) {
        // Create message hash including all sponsorship details
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(userAddress, sponsoredAmount, uint8(paymentType), sponsorshipNonce))
        ));
        
        // Recover signer from signature
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recoveredSigner = ecrecover(messageHash, v, r, s);
        
        return recoveredSigner == dealer;
    }
    
    /**
     * @notice Cash out winnings after completing turns offchain
     * @param nextHash The next hash in the chain
     * @param finalTurn The turn number this hash corresponds to
     */
    function cashOut(bytes32 nextHash, uint8 finalTurn) external {
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        require(game.status == GameStatus.Active, "Game is not active");
        require(finalTurn > 0 && finalTurn <= GAME_MAX_TURNS, "Invalid turn number");
        
        // Verify the hash chain leads back to the commitment
        // Hash should be hashed exactly finalTurn times to match commitment
        bytes32 currentHash = nextHash;
        for (uint8 i = 0; i < finalTurn; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");
        _distributePrize(game, finalTurn, game.paymentType);
        game.status = GameStatus.Completed;
    }

    /**
     * @notice Update active game counters when games start or end
     * @param wagerAmount The wager amount
     * @param paymentType The payment type (Token or ETH)
     * @param isStarting True if game is starting, false if ending
     */
    function _updateActiveGameCounters(uint256 wagerAmount, PaymentType paymentType, bool isStarting) internal {
        if (isStarting) {
            activeGameCount++;
            if (paymentType == PaymentType.Token) {
                totalActiveTokenWagers += wagerAmount;
            } else {
                totalActiveEthWagers += wagerAmount;
            }
        } else {
            activeGameCount--;
            if (paymentType == PaymentType.Token) {
                totalActiveTokenWagers -= wagerAmount;
            } else {
                totalActiveEthWagers -= wagerAmount;
            }
        }
    }

    function _distributePrize(Game memory game, uint8 finalTurn, PaymentType paymentType) internal {
        uint256 prize = calculateCurrentPot(game, finalTurn);
        
        // Update active game tracking
        _updateActiveGameCounters(game.wager, game.paymentType, false);
        
        if (paymentType == PaymentType.Token) {
            require(erc20Token.transfer(msg.sender, prize), "Token transfer failed");
        } else {
            (bool success, ) = payable(msg.sender).call{value: prize}("");
            require(success, "ETH transfer failed");
        }
        emit GameEnded(msg.sender, game.gameId, finalTurn, true, prize, game.paymentType);
    }

    // Get full game state
    function getGameState(address player) external view returns (Game memory) {
        uint256 activeGameId = playerGameCounters[player] > 0 ? playerGameCounters[player] - 1 : 0;
        Game storage game = playerGames[player][activeGameId];
        return game;
    }
    
    // Get specific game state by gameId
    function getGameStateById(address player, uint256 gameId) external view returns (Game memory) {
        Game storage game = playerGames[player][gameId];
        return game;
    }
    
    /**
     * @notice Request a withdrawal due to backend inactivity
     * @dev Initiates a timelock period after which the player can withdraw if the backend doesn't respond
     */
    function requestWithdrawal(Guess lastGuess, bytes32 previousHash, uint8 finalTurn) external {
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(withdrawalRequests[msg.sender].timestamp == 0, "Withdrawal already requested");

        // Verify the hash chain leads back to the commitment
        bytes32 currentHash = previousHash;
        for (uint8 i = 0; i < finalTurn + 1; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");

        // Set the withdrawal request data
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            timestamp: block.timestamp,
            lastGuess: lastGuess,
            previousHash: previousHash,
            finalTurn: finalTurn
        });
        
        emit WithdrawalRequested(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Cancel a pending withdrawal request
     * @dev Allows players to cancel their withdrawal request if they change their mind
     */
    function cancelWithdrawalRequest() external {
        require(withdrawalRequests[msg.sender].timestamp > 0, "No withdrawal request found");
        delete withdrawalRequests[msg.sender];
        emit WithdrawalCancelled(msg.sender);
    }
    
    /**
     * @notice Process a withdrawal after the timelock has expired
     */
    function processWithdrawal() external {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];
        require(request.timestamp > 0, "No withdrawal request found");
        require(block.timestamp >= request.timestamp + withdrawalTimelock, "Timelock period not yet expired");
        
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        
        // Verify the hash chain leads back to the commitment using saved data
        bytes32 currentHash = request.previousHash;
        for (uint8 i = 0; i < request.finalTurn + 1; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");
        
        _distributePrize(game, request.finalTurn, game.paymentType);
        delete withdrawalRequests[msg.sender];
    }

    /**
     * @notice Internal function to prove player loss and end game
     * @param player The player address
     * @param playerGuess The player's guess
     * @param previousHash The hash for the previous card
     * @param nextHash The next hash in the chain that results in loss
     * @param finalTurn The turn number this hash corresponds to
     */
    function _provePlayerLossAndEndGame(address player, Guess playerGuess, bytes32 previousHash, bytes32 nextHash, uint8 finalTurn) internal {
        // Get the active game
        uint256 activeGameId = playerGameCounters[player] - 1;
        Game storage game = playerGames[player][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(finalTurn > 0 && finalTurn <= GAME_MAX_TURNS, "Invalid turn number");
        
        // Verify the hash chain leads back to the commitment
        bytes32 currentHash = nextHash;
        for (uint8 i = 0; i < finalTurn; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");
        
        // Get the cards from the hash with added user entropy
        Card newCard = _getCardFromHash(nextHash, game.userRandomNonce, player, game.gameId);
        Card previousCard = _getCardFromHash(previousHash, game.userRandomNonce, player, game.gameId);
        
        // Verify player would lose with their guess
        bool playerWouldWin = _checkWin(previousCard, newCard, playerGuess);
        require(!playerWouldWin, "Player would win with this move");
        
        // Player lost, mark game as completed
        game.status = GameStatus.Completed;
        
        // Update active game tracking
        _updateActiveGameCounters(game.wager, game.paymentType, false);
        
        // If there's a pending withdrawal request, cancel it
        if (withdrawalRequests[player].timestamp > 0) {
            delete withdrawalRequests[player];
        }
        
        emit GameEnded(player, game.gameId, finalTurn, false, 0, game.paymentType);
    }

    /**
     * @notice Dealer can provide proof that the player would lose, cancelling the withdrawal
     * @param player The player address
     * @param nextHash The next hash in the chain
     * @param finalTurn The turn number this hash corresponds to
     */
    function proveLoss(address player, bytes32 nextHash, uint8 finalTurn) external onlyDealer {
        WithdrawalRequest storage request = withdrawalRequests[player];
        require(request.timestamp > 0, "No withdrawal request for this player");
        
        // Use the common internal function with withdrawal request data
        _provePlayerLossAndEndGame(player, request.lastGuess, request.previousHash, nextHash, finalTurn);
    }
    
    /**
     * @notice Dealer can end the game by proving a player's signed move would result in loss
     * @param player The player address
     * @param playerGuessSignature The player's signature of their guess
     * @param playerGuess The player's guess
     * @param nextHash The next hash in the chain that would result in loss
     * @param finalTurn The turn number this hash corresponds to
     */
    function endGameWithProofOfLoss(address player, bytes memory playerGuessSignature, Guess playerGuess, bytes32 nextHash, uint8 finalTurn) external onlyDealer {
        // Get the active game to verify signature
        uint256 activeGameId = playerGameCounters[player] - 1;
        Game storage game = playerGames[player][activeGameId];
        
        // Verify the player's guess signature
        require(_verifyGuessSignature(playerGuessSignature, game.gameId, finalTurn, playerGuess, player), "Invalid player guess signature");
        
        // Calculate previous hash (one step back in the chain)
        bytes32 previousHash = keccak256(abi.encodePacked(nextHash));
        
        // Use the common internal function
        _provePlayerLossAndEndGame(player, playerGuess, previousHash, nextHash, finalTurn);
    }
    
    /**
     * @notice Calculate reserved funds for active games (max possible winnings)
     * @param paymentType The payment type to calculate reserves for
     * @return The amount reserved for active games
     */
    function calculateReservedFunds(PaymentType paymentType) public view returns (uint256) {
        if (paymentType == PaymentType.Token) {
            return calculateMaxPot(totalActiveTokenWagers);
        } else {
            return calculateMaxPot(totalActiveEthWagers);
        }
    }
    
    /**
     * @notice Allows admin to directly withdraw ETH or tokens without timelock
     * @param amount The amount to withdraw
     * @param paymentType The type of payment to withdraw (Token or ETH)
     */
    function adminDirectWithdraw(uint256 amount, PaymentType paymentType) external onlyAdmin {
        require(amount > 0, "Amount must be greater than zero");
        
        if (paymentType == PaymentType.Token) {
            uint256 tokenBalance = erc20Token.balanceOf(address(this));
            uint256 reservedFunds = calculateReservedFunds(PaymentType.Token);
            require(amount <= tokenBalance - reservedFunds, "Cannot withdraw reserved funds for active games");
            require(erc20Token.transfer(admin, amount), "Token transfer failed");
        } else {
            uint256 ethBalance = address(this).balance;
            uint256 reservedFunds = calculateReservedFunds(PaymentType.ETH);
            require(amount <= ethBalance - reservedFunds, "Cannot withdraw reserved funds for active games");
            (bool success, ) = payable(admin).call{value: amount}("");
            require(success, "ETH transfer failed");
        }
        
        emit AdminDirectWithdrawal(amount, paymentType);
    }
    
    // Required to receive ETH
    receive() external payable {}
}