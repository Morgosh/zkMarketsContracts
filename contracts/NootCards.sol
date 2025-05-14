// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title NootCards - High/Low Card Game (Trustless Version)
 * @notice This version implements a provably fair and verifiable card sequence
 * using deterministic cryptographic randomness, user-side entropy, and hash chaining.
 * 
 * Implementation features:
 * - Dealer commits to a hash chain (final hash of a sequence of hashes)
 * - Each round, dealer reveals the next hash in reverse order from the chain
 * - Contract verifies each revealed hash is part of the original committed chain
 * - Card for each round is determined by combining the verified hash with user entropy
 * - Dispute resolution if dealer acts maliciously (eg. doesn't reveal hashes)
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
    enum GameStatus { Active, Completed }
    enum PaymentType { Token, ETH }
    
    // Add constant for maximum turns
    uint8 constant public GAME_MAX_TURNS = 10;
    
    struct Game {
        address player;
        uint256 wager;
        Card currentCard;
        Guess currentGuess;
        GameStatus status;
        uint8 turn;
        uint256 gameId;
        bytes32 commitment;     // Dealer's commitment (hash of the final hash in the chain)
        bytes32 userRandomNonce; // Player's random nonce
        PaymentType paymentType; // Whether the game uses Token or ETH
    }
    
    address public admin;
    address public immutable dealer;      // The dealer address (replaces trusted signer)
    IERC20 public nootToken;
    uint256 public minWager;
    uint256 public maxWager;
    uint256 public minEthWager; // Minimum wager for ETH games
    uint256 public maxEthWager; // Maximum wager for ETH games
    
    // Add withdrawal timelock duration
    uint256 public immutable withdrawalTimelock = 48 hours;
    
    // Add player-specific game counter
    mapping(address => uint256) public playerGameCounters;
    
    // Add withdrawal request timestamps
    mapping(address => uint256) public withdrawalRequests;
    
    // Admin's pending withdrawal request
    struct AdminWithdrawalRequest {
        uint256 tokenAmount;
        uint256 ethAmount;
        uint256 timestamp;
    }
    AdminWithdrawalRequest public adminRequest;
    
    // Store all games per player by gameId
    mapping(address => mapping(uint256 => Game)) public playerGames;
    
    // Track used sponsorship nonces
    mapping(bytes32 => bool) public usedSponsorshipNonces;
    
    event GameStarted(address indexed player, uint256 wager, uint8 turns, uint256 gameId, bytes32 commitment, PaymentType paymentType, bytes32 sponsorshipNonce);
    event GuessMade(address indexed player, uint256 gameId, uint8 turn, Guess guess);
    event GameLost(address indexed player, uint256 gameId, Card previousCard, Card newCard, Guess guess, bytes32 currentHash);
    event GameWon(address indexed player, uint256 gameId, uint256 prize, PaymentType paymentType);
    event WithdrawalRequested(address indexed player, uint256 timestamp);
    event WithdrawalProcessed(address indexed player, uint256 amount, PaymentType paymentType);
    event WithdrawalCancelled(address indexed player);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event AdminDirectWithdrawal(uint256 amount, PaymentType paymentType);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "NootCards: caller is not the admin");
        _;
    }
    
    modifier onlyDealer() {
        require(msg.sender == dealer, "NootCards: caller is not the dealer");
        _;
    }
    
    constructor(
        address _nootToken, 
        address _dealer, 
        uint256 _minWager, 
        uint256 _maxWager,
        uint256 _minEthWager,
        uint256 _maxEthWager
    ) {
        require(_nootToken != address(0), "NootCards: token address cannot be zero");
        require(_dealer != address(0), "NootCards: dealer address cannot be zero");
        
        admin = msg.sender; // Deployer is the default admin
        dealer = _dealer;   // Set the dealer address
        nootToken = IERC20(_nootToken);
        minWager = _minWager;
        maxWager = _maxWager;
        minEthWager = _minEthWager;
        maxEthWager = _maxEthWager;
    }
    
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "NootCards: new admin is the zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
    
    function updateWagerLimits(uint256 _minWager, uint256 _maxWager) external onlyAdmin {
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function updateEthWagerLimits(uint256 _minEthWager, uint256 _maxEthWager) external onlyAdmin {
        minEthWager = _minEthWager;
        maxEthWager = _maxEthWager;
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
    function _getCardFromHash(
        bytes32 hash, 
        bytes32 userRandomNonce, 
        address player, 
        uint256 gameId
    ) internal pure returns (Card) {
        // Combine hash with user entropy
        bytes32 combinedHash = keccak256(abi.encodePacked(
            hash,
            userRandomNonce,
            player,
            gameId
        ));
        
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
    
    // Verify a commitment signature from the dealer, now includes userAddress and gameId
    function _verifyCommitmentSignature(
        bytes32 commitment, 
        bytes memory signature,
        address userAddress,
        uint256 gameId
    ) internal view returns (bool) {
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
     * @return The calculated current pot value
     */
    function calculateCurrentPot(Game memory game) public pure returns (uint256) {
        if (game.status != GameStatus.Active || game.turn == 0) {
            return 0;
        }
        
        uint256 pot = game.wager;
        // Apply multipliers for each completed turn (up to current turn)
        for (uint8 i = 1; i <= game.turn; i++) {
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
        
        for (uint8 i = 1; i <= GAME_MAX_TURNS; i++) { // Use constant
            pot = (pot * calculateTurnMultiplier(i)) / 100;
        }
        
        return pot;
    }
    
    /**
     * @notice Internal function to start a game (common logic for both regular and sponsored games)
     */
    function _startGame(
        address player,
        uint256 wagerAmount,
        bytes32 userRandomNonce,
        bytes32 dealerCommitment,
        bytes memory commitmentSignature,
        PaymentType paymentType,
        bool isSponsored,
        bytes32 sponsorshipNonce
    ) internal {
        // Check if the player has a pending withdrawal request
        require(withdrawalRequests[player] == 0, "Pending withdrawal request exists");
        
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
        require(
            _verifyCommitmentSignature(dealerCommitment, commitmentSignature, player, gameId),
            "Invalid commitment signature"
        );
        
        // Initialize the game
        playerGames[player][gameId] = Game({
            player: player,
            wager: wagerAmount,
            currentCard: Card.Two, // Default starting card
            currentGuess: Guess.Higher, // Default starting guess
            status: GameStatus.Active,
            turn: 0,
            gameId: gameId,
            commitment: dealerCommitment,
            userRandomNonce: userRandomNonce,
            paymentType: paymentType
        });
        
        // Emit appropriate event
        emit GameStarted(
            player,
            wagerAmount,
            GAME_MAX_TURNS,
            gameId,
            dealerCommitment,
            paymentType,
            isSponsored ? sponsorshipNonce : bytes32(0)
        );
    }

    /**
     * @notice Start a new game with the dealer's commitment and player's random nonce
     * @param wagerAmount The amount of tokens to wager (ignored if using ETH)
     * @param userRandomNonce The player's random nonce to be combined with the dealer's seed
     * @param dealerCommitment The dealer's commitment (hash of privateSecret)
     * @param commitmentSignature The dealer's signature of the commitment
     */
    function startGame(
        uint256 wagerAmount,
        bytes32 userRandomNonce,
        bytes32 dealerCommitment,
        bytes memory commitmentSignature
    ) external payable {
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
            
            // Transfer NOOT tokens from player to contract
            require(nootToken.transferFrom(msg.sender, address(this), actualWager), "Token transfer failed");
        }
        
        // Start the game using common logic
        _startGame(
            msg.sender,
            actualWager,
            userRandomNonce,
            dealerCommitment,
            commitmentSignature,
            paymentType,
            false, // Not sponsored
            bytes32(0) // No sponsorship nonce
        );
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
    function startSponsoredGame(
        bytes32 userRandomNonce,
        bytes32 dealerCommitment,
        bytes memory commitmentSignature,
        uint256 sponsoredAmount,
        PaymentType paymentType,
        bytes32 sponsorshipNonce,
        bytes memory sponsorshipSignature
    ) external {
        // Ensure the nonce hasn't been used before
        require(!usedSponsorshipNonces[sponsorshipNonce], "Sponsorship nonce already used");
        
        // Verify sponsorship signature
        require(
            _verifySponsorshipSignature(
                msg.sender, 
                sponsoredAmount, 
                paymentType, 
                sponsorshipNonce, 
                sponsorshipSignature
            ),
            "Invalid sponsorship signature"
        );
        
        // Mark sponsorship nonce as used
        usedSponsorshipNonces[sponsorshipNonce] = true;
        
        // Start the game using common logic
        _startGame(
            msg.sender,
            sponsoredAmount,
            userRandomNonce,
            dealerCommitment,
            commitmentSignature,
            paymentType,
            true, // Is sponsored
            sponsorshipNonce
        );
    }
    
    // Verify a sponsorship signature from the dealer
    function _verifySponsorshipSignature(
        address userAddress,
        uint256 sponsoredAmount,
        PaymentType paymentType,
        bytes32 sponsorshipNonce,
        bytes memory signature
    ) internal view returns (bool) {
        // Create message hash including all sponsorship details
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(
                userAddress,
                sponsoredAmount,
                uint8(paymentType),
                sponsorshipNonce
            ))
        ));
        
        // Recover signer from signature
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recoveredSigner = ecrecover(messageHash, v, r, s);
        
        return recoveredSigner == dealer;
    }
    
    /**
     * @notice Player submits the next hash in the chain and makes a guess
     * @param nextHash The next hash in the chain
     * @param newGuess The player's guess for the next round
     */
    function makeGuess(bytes32 nextHash, Guess newGuess) external {
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(game.turn < GAME_MAX_TURNS, "No turns left");
        
        // verify the hash chain leads back to the commitment
        // Hash should be hashed exactly game.turn times to match commitment
        bytes32 currentHash = nextHash;
        for (uint8 i = 0; i < game.turn + 1; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");

        // Get the new card from the next hash with added user entropy
        Card newCard = _getCardFromHash(
            nextHash, 
            game.userRandomNonce, 
            msg.sender, 
            game.gameId
        );
        game.turn++;


        // First turn should always pass (no previous guess to check)
        if (game.turn == 1) {
            // Update card and guess
            game.currentCard = newCard;
            game.currentGuess = newGuess;
            
            emit GuessMade(
                msg.sender,
                game.gameId,
                game.turn,
                newGuess
            );
            
            return;
        }
        
        // Check if the previous guess was correct
        bool roundWon = _checkWin(game.currentCard, newCard, game.currentGuess);

        if (roundWon) {
            // Update card and guess
            game.currentCard = newCard;
            game.currentGuess = newGuess;
            emit GuessMade(
                msg.sender,
                game.gameId,
                game.turn,
                newGuess
            );
            
            // If player has completed all rounds, they win the game
            if (game.turn == GAME_MAX_TURNS) {
                uint256 prize = calculateCurrentPot(game);
                game.status = GameStatus.Completed;
                
                // Transfer prize based on payment type
                if (game.paymentType == PaymentType.Token) {
                    // Transfer NOOT tokens from contract to winner
                    require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
                } else {
                    // Transfer ETH from contract to winner
                    (bool success, ) = payable(msg.sender).call{value: prize}("");
                    require(success, "ETH transfer failed");
                }
                
                emit GameWon(msg.sender, game.gameId, prize, game.paymentType);
            }
        } else {
            // Player lost
            game.status = GameStatus.Completed;
            emit GameLost(msg.sender, game.gameId, game.currentCard, newCard, game.currentGuess, nextHash);
            game.currentCard = newCard;
        }
    }
    
    /**
     * @notice Allows a player to claim their current pot and end the game early
     * @param nextHash The next hash in the chain (to verify the player did not lose the game)
     */
    function claimRewards(bytes32 nextHash) external {
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(game.turn > 0, "Must complete at least one round");
        
        // Verify the hash chain leads back to the commitment
        // Hash should be hashed exactly game.turn times to match commitment
        bytes32 currentHash = nextHash;
        for (uint8 i = 0; i < game.turn + 1; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");
        
        // Get the next card from hash with added user entropy
        Card nextCard = _getCardFromHash(
            nextHash, 
            game.userRandomNonce, 
            msg.sender, 
            game.gameId
        );
        
        // Check if the player's guess would win
        require(
            _checkWin(game.currentCard, nextCard, game.currentGuess),
            "Current guess would not win next turn"
        );
        
        uint256 prize = calculateCurrentPot(game);
        game.status = GameStatus.Completed;
        
        // Transfer prize based on payment type
        if (game.paymentType == PaymentType.Token) {
            // Transfer NOOT tokens from contract to winner
            require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
        } else {
            // Transfer ETH from contract to winner
            (bool success, ) = payable(msg.sender).call{value: prize}("");
            require(success, "ETH transfer failed");
        }
        
        emit GameWon(msg.sender, game.gameId, prize, game.paymentType);
    }
    
    // Get full game state
    function getGameState(address player) external view returns (
        GameStatus status,
        uint256 wager,
        uint256 currentPot,
        Card previousCard,
        Guess previousGuess,
        uint8 turn,
        uint256 gameId,
        bytes32 commitment,
        bytes32 userRandomNonce,
        PaymentType paymentType
    ) {
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[player] > 0 ? playerGameCounters[player] - 1 : 0;
        Game storage game = playerGames[player][activeGameId];
        
        return (
            game.status,
            game.wager,
            calculateCurrentPot(game),
            game.currentCard,
            game.currentGuess,
            game.turn,
            game.gameId,
            game.commitment,
            game.userRandomNonce,
            game.paymentType
        );
    }
    
    // Get specific game state by gameId
    function getGameStateById(address player, uint256 gameId) external view returns (
        GameStatus status,
        uint256 wager,
        uint256 currentPot,
        Card previousCard,
        Guess previousGuess,
        uint8 turn,
        uint256 gameIdReturn,
        bytes32 commitment,
        bytes32 userRandomNonce,
        PaymentType paymentType
    ) {
        Game storage game = playerGames[player][gameId];
        
        return (
            game.status,
            game.wager,
            calculateCurrentPot(game),
            game.currentCard,
            game.currentGuess,
            game.turn,
            game.gameId,
            game.commitment,
            game.userRandomNonce,
            game.paymentType
        );
    }
    
    /**
     * @notice Request a withdrawal due to backend inactivity
     * @dev Initiates a timelock period after which the player can withdraw if the backend doesn't respond
     */
    function requestWithdrawal() external {
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(game.turn > 0, "Must have made at least one move");
        require(withdrawalRequests[msg.sender] == 0, "Withdrawal already requested");
        
        // Set the withdrawal request timestamp
        withdrawalRequests[msg.sender] = block.timestamp;
        
        emit WithdrawalRequested(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Cancel a pending withdrawal request
     * @dev Allows players to cancel their withdrawal request if they change their mind
     */
    function cancelWithdrawalRequest() external {
        require(withdrawalRequests[msg.sender] > 0, "No withdrawal request found");
        
        // Clear the withdrawal request
        withdrawalRequests[msg.sender] = 0;
        
        emit WithdrawalCancelled(msg.sender);
    }
    
    /**
     * @notice Process a withdrawal after the timelock has expired
     */
    function processWithdrawal() external {
        uint256 requestTime = withdrawalRequests[msg.sender];
        require(requestTime > 0, "No withdrawal request found");
        require(block.timestamp >= requestTime + withdrawalTimelock, "Timelock period not yet expired");
        
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[msg.sender] - 1;
        Game storage game = playerGames[msg.sender][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        
        // Calculate the current pot
        uint256 prize = calculateCurrentPot(game);
        PaymentType paymentType = game.paymentType;
        
        // Reset game and withdrawal request
        game.status = GameStatus.Completed;
        withdrawalRequests[msg.sender] = 0;
        
        // Transfer prize based on payment type
        if (paymentType == PaymentType.Token) {
            // Transfer NOOT tokens to player
            require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
        } else {
            // Transfer ETH to player
            (bool success, ) = payable(msg.sender).call{value: prize}("");
            require(success, "ETH transfer failed");
        }
        
        emit WithdrawalProcessed(msg.sender, prize, paymentType);
    }
    
    /**
     * @notice Dealer can provide proof that the player would lose, cancelling the withdrawal
     * @param player The player address
     * @param nextHash The next hash in the chain
     */
    function proveLoss(address player, bytes32 nextHash) external onlyDealer {
        require(withdrawalRequests[player] > 0, "No withdrawal request for this player");
        
        // Get the active game (most recent game)
        uint256 activeGameId = playerGameCounters[player] - 1;
        Game storage game = playerGames[player][activeGameId];
        
        require(game.status == GameStatus.Active, "Game is not active");
        
        // Verify the hash chain leads back to the commitment
        // Hash should be hashed exactly game.turn times to match commitment
        bytes32 currentHash = nextHash;
        for (uint8 i = 0; i < game.turn + 1; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        require(currentHash == game.commitment, "Invalid hash chain");
        
        // Get the new card from the hash with added user entropy
        Card newCard = _getCardFromHash(
            nextHash, 
            game.userRandomNonce, 
            player, 
            game.gameId
        );
        
        // Check if the player's guess would lose
        bool playerWouldWin = _checkWin(game.currentCard, newCard, game.currentGuess);
        require(!playerWouldWin, "Player would win with this hash");
        
        // Player lost, mark game as completed
        game.status = GameStatus.Completed;
        
        // Reset withdrawal request
        withdrawalRequests[player] = 0;
        
        emit GameLost(player, game.gameId, game.currentCard, newCard, game.currentGuess, nextHash);
    }
    
    /**
     * @notice Allows admin to directly withdraw ETH or tokens without timelock
     * @param amount The amount to withdraw
     * @param paymentType The type of payment to withdraw (Token or ETH)
     */
    function adminDirectWithdraw(uint256 amount, PaymentType paymentType) external onlyAdmin {
        require(amount > 0, "Amount must be greater than zero");
        
        if (paymentType == PaymentType.Token) {
            uint256 tokenBalance = nootToken.balanceOf(address(this));
            require(amount <= tokenBalance, "Insufficient token balance");
            require(nootToken.transfer(admin, amount), "Token transfer failed");
        } else {
            require(amount <= address(this).balance, "Insufficient ETH balance");
            (bool success, ) = payable(admin).call{value: amount}("");
            require(success, "ETH transfer failed");
        }
        
        emit AdminDirectWithdrawal(amount, paymentType);
    }
    
    // Required to receive ETH
    receive() external payable {}
} 

// could use this for admin withdrawals in future but we ultimately decided against delaying the withdrawal process for admin withdrawals

// event AdminWithdrawalRequested(uint256 tokenAmount, uint256 ethAmount, uint256 timestamp);
// event AdminWithdrawalProcessed(uint256 amount, PaymentType paymentType);
// /**
//  * @notice Request admin withdrawal with timelock for both token and ETH
//  * @param tokenAmount The amount of tokens to withdraw
//  * @param ethAmount The amount of ETH to withdraw
//  */
// function requestAdminWithdrawal(uint256 tokenAmount, uint256 ethAmount) external onlyAdmin {
//     // Ensure there's no pending withdrawal request
//     require(adminRequest.timestamp == 0, "Admin withdrawal already requested");
    
//     // Ensure at least one amount is greater than zero
//     require(tokenAmount > 0 || ethAmount > 0, "At least one amount must be greater than zero");
    
//     // Ensure the requested amounts are available
//     if (tokenAmount > 0) {
//         uint256 tokenBalance = nootToken.balanceOf(address(this));
//         require(tokenAmount <= tokenBalance, "Insufficient token balance");
//     }
    
//     if (ethAmount > 0) {
//         require(ethAmount <= address(this).balance, "Insufficient ETH balance");
//     }
    
//     // Create withdrawal request
//     adminRequest = AdminWithdrawalRequest({
//         tokenAmount: tokenAmount,
//         ethAmount: ethAmount,
//         timestamp: block.timestamp
//     });
    
//     emit AdminWithdrawalRequested(tokenAmount, ethAmount, block.timestamp);
// }

// /**
//  * @notice Process admin withdrawal after timelock expires
//  */
// function processAdminWithdrawal() external onlyAdmin {
//     // Verify there's a pending request
//     require(adminRequest.timestamp > 0, "No admin withdrawal request");
    
//     // Verify timelock has expired
//     require(block.timestamp >= adminRequest.timestamp + withdrawalTimelock, 
//             "Withdrawal timelock not expired");
    
//     // Get amounts and reset request
//     uint256 tokenAmount = adminRequest.tokenAmount;
//     uint256 ethAmount = adminRequest.ethAmount;
//     adminRequest.tokenAmount = 0;
//     adminRequest.ethAmount = 0;
//     adminRequest.timestamp = 0;
    
//     // Transfer tokens if requested
//     if (tokenAmount > 0) {
//         require(nootToken.transfer(admin, tokenAmount), "Token transfer failed");
//         emit AdminWithdrawalProcessed(tokenAmount, PaymentType.Token);
//     }
    
//     // Transfer ETH if requested
//     if (ethAmount > 0) {
//         (bool success, ) = payable(admin).call{value: ethAmount}("");
//         require(success, "ETH transfer failed");
//         emit AdminWithdrawalProcessed(ethAmount, PaymentType.ETH);
//     }
// }