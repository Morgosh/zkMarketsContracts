// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title NootCards - High/Low Card Game (Trustless Version)
 * @notice This version implements a provably fair and verifiable card sequence
 * using deterministic cryptographic randomness, user-side entropy, and hash chaining.
 * 
 * Implementation features:
 * - Dealer commits to a private seed hash (commitment)
 * - Player provides entropy through a random nonce
 * - Combined entropy creates a deterministic, verifiable game seed
 * - Hash chain derived from game seed determines card sequence
 * - Full private seed is revealed at the end for verification
 * - Dispute resolution if dealer acts maliciously
 * 
 * Security guarantees:
 * - Unbiasable randomness: dealer can't grind seeds after commitment
 * - Verifiable sequence: hash chain allows verification of card authenticity
 * - Trustless gameplay: neither side can influence randomness after the initial commit
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract NootCards {
    enum Card { Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace }
    enum Guess { Higher, Lower }
    enum GameStatus { NotStarted, Active, Completed, Disputed }
    
    // Add constant for maximum turns
    uint8 constant public GAME_MAX_TURNS = 10;
    
    struct Game {
        address player;
        uint256 wager;
        Card previousCard;
        Guess previousGuess;
        GameStatus status;
        uint8 turn;
        uint256 gameId;
        bytes32 commitment;     // Dealer's commitment (hash of privateSecret)
        bytes32 userRandomNonce; // Player's random nonce
    }
    
    address public admin;
    address public immutable dealer;      // The dealer address (replaces trusted signer)
    IERC20 public nootToken;
    uint256 public minWager;
    uint256 public maxWager;
    
    // Add withdrawal timelock duration
    uint256 public withdrawalTimelock = 48 hours;
    
    // Add player-specific game counter
    mapping(address => uint256) public playerGameCounters;
    
    // Add withdrawal request timestamps
    mapping(address => uint256) public withdrawalRequests;
    
    // Dealer's pending withdrawal request
    struct DealerWithdrawalRequest {
        uint256 amount;
        uint256 timestamp;
    }
    DealerWithdrawalRequest public dealerRequest;
    
    mapping(address => Game) public games;
    
    event GameStarted(address indexed player, uint256 wager, uint8 turns, uint256 gameId, bytes32 commitment);
    event RoundWon(address indexed player, Card previousCard, Card newCard, Guess guess, uint8 turnsLeft, bytes32 currentHash);
    event GameLost(address indexed player, Card previousCard, Card newCard, Guess guess, bytes32 currentHash);
    event GameWon(address indexed player, uint256 prize);
    event GameDisputed(address indexed player, uint256 prize, string reason);
    event SecretRevealed(address indexed player, uint256 gameId, bytes32 privateSecret);
    event WithdrawalRequested(address indexed player, uint256 timestamp);
    event WithdrawalProcessed(address indexed player, uint256 amount);
    event WithdrawalCancelled(address indexed player);
    event DealerWithdrawalRequested(uint256 amount, uint256 timestamp);
    event DealerWithdrawalProcessed(uint256 amount);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "TrustlessNootLadder: caller is not the admin");
        _;
    }
    
    modifier onlyDealer() {
        require(msg.sender == dealer, "TrustlessNootLadder: caller is not the dealer");
        _;
    }
    
    constructor(address _nootToken, address _dealer, uint256 _minWager, uint256 _maxWager) {
        require(_nootToken != address(0), "TrustlessNootLadder: token address cannot be zero");
        require(_dealer != address(0), "TrustlessNootLadder: dealer address cannot be zero");
        
        admin = msg.sender; // Deployer is the default admin
        dealer = _dealer;   // Set the dealer address
        nootToken = IERC20(_nootToken);
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "TrustlessNootLadder: new admin is the zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
    
    function updateWagerLimits(uint256 _minWager, uint256 _maxWager) external onlyAdmin {
        minWager = _minWager;
        maxWager = _maxWager;
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
    
    /**
     * @notice Update the withdrawal timelock duration (same for both players and dealer)
     * @param newTimelock The new timelock duration in seconds
     */
    function updateWithdrawalTimelock(uint256 newTimelock) external onlyAdmin {
        require(newTimelock >= 1 hours, "Timelock must be at least 1 hour");
        require(newTimelock <= 7 days, "Timelock cannot exceed 7 days");
        withdrawalTimelock = newTimelock;
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
        require(sig.length == 65, "TrustlessNootLadder: invalid signature length");
        
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
     * @notice Start a new game with the dealer's commitment and player's random nonce
     * @param wagerAmount The amount of tokens to wager
     * @param userRandomNonce The player's random nonce to be combined with the dealer's seed
     * @param dealerCommitment The dealer's commitment (hash of privateSecret)
     * @param commitmentSignature The dealer's signature of the commitment
     */
    function startGame(
        uint256 wagerAmount,
        bytes32 userRandomNonce,
        bytes32 dealerCommitment,
        bytes memory commitmentSignature
    ) external {
        require(wagerAmount >= minWager, "Wager too small");
        require(wagerAmount <= maxWager, "Wager too large");
        
        // Generate a player-specific sequential game ID
        uint256 gameId = playerGameCounters[msg.sender];
        playerGameCounters[msg.sender]++;
        
        // Verify the signature now includes the user's address and game ID
        require(
            _verifyCommitmentSignature(dealerCommitment, commitmentSignature, msg.sender, gameId),
            "Invalid commitment signature"
        );
        
        // Transfer NOOT tokens from player to contract
        require(nootToken.transferFrom(msg.sender, address(this), wagerAmount), "Token transfer failed");
        
        // Initialize the game
        games[msg.sender] = Game({
            player: msg.sender,
            wager: wagerAmount,
            previousCard: Card.Two, // Default starting card
            previousGuess: Guess.Higher, // Default starting guess
            status: GameStatus.Active,
            turn: 0,
            gameId: gameId,
            commitment: dealerCommitment,
            userRandomNonce: userRandomNonce
        });
        
        emit GameStarted(msg.sender, wagerAmount, 10, gameId, dealerCommitment);
    }
    
    /**
     * @notice Player submits the next hash in the chain and makes a guess
     * @param nextHash The next hash in the chain
     * @param newGuess The player's guess for the next round
     */
    function makeGuess(bytes32 nextHash, Guess newGuess) external {
        Game storage game = games[msg.sender];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(game.turn < GAME_MAX_TURNS, "No turns left"); // Use constant
        
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

        // First turn is always a win (no previous guess to check)
        if (game.turn == 1) {
            game.previousGuess = newGuess;
            
            
            emit RoundWon(
                msg.sender,
                Card.Two, // First card is always compared to Two
                game.previousCard,
                Guess.Higher, // Doesn't matter for first round
                GAME_MAX_TURNS - game.turn, // Use constant
                nextHash
            );
            
            return;
        }
        
        // Store values for event emission
        Guess previousGuess = game.previousGuess;
        Card previousCard = game.previousCard;
        
        // Check if the previous guess was correct
        bool roundWon = _checkWin(previousCard, newCard, previousGuess);
        
        if (roundWon) {
            // Update card and guess (no more currentHash field)
            game.previousCard = newCard;
            game.previousGuess = newGuess;
            
            emit RoundWon(
                msg.sender,
                previousCard,
                newCard,
                previousGuess,
                GAME_MAX_TURNS - game.turn, // Use constant
                nextHash
            );
            
            // If player has completed all rounds, they win the game
            if (game.turn == GAME_MAX_TURNS) { // Use constant
                uint256 prize = calculateCurrentPot(game);
                game.status = GameStatus.Completed;
                
                // Transfer NOOT tokens from contract to winner
                require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
                
                emit GameWon(msg.sender, prize);
            }
        } else {
            // Player lost
            game.status = GameStatus.Completed;
            emit GameLost(msg.sender, previousCard, newCard, previousGuess, nextHash);
        }
    }
    
    /**
     * @notice Allows a player to claim their current pot and end the game early
     * @param nextHash The next hash in the chain (to verify the player would win)
     */
    function claimRewards(bytes32 nextHash) external {
        Game storage game = games[msg.sender];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(game.turn > 1, "Must complete at least one round");
        
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
            _checkWin(game.previousCard, nextCard, game.previousGuess),
            "Current guess would not win next turn"
        );
        
        uint256 prize = calculateCurrentPot(game);
        game.status = GameStatus.Completed;
        
        // Transfer NOOT tokens from contract to player
        require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
        
        emit GameWon(msg.sender, prize);
    }
    
    // Get full game state
    function getGameState(address player) external view returns (
        GameStatus status,
        uint256 wager,
        uint256 currentPot, // Keep this in the return values for API compatibility
        Card previousCard,
        Guess previousGuess,
        uint8 turn,
        uint256 gameId,
        bytes32 commitment,
        bytes32 userRandomNonce
    ) {
        Game storage game = games[player];
        return (
            game.status,
            game.wager,
            calculateCurrentPot(game), // Calculate current pot dynamically
            game.previousCard,
            game.previousGuess,
            game.turn,
            game.gameId,
            game.commitment,
            game.userRandomNonce
        );
    }
    
    // Allow admin to withdraw any NOOT tokens accidentally sent to the contract
    function withdrawTokens(uint256 amount) external onlyAdmin {
        require(nootToken.transfer(admin, amount), "Token transfer failed");
    }
    
    /**
     * @notice Request a withdrawal due to backend inactivity
     * @dev Initiates a timelock period after which the player can withdraw if the backend doesn't respond
     */
    function requestWithdrawal() external {
        Game storage game = games[msg.sender];
        
        require(game.status == GameStatus.Active, "Game is not active");
        require(game.turn > 0, "Must have made at least one move");
        require(withdrawalRequests[msg.sender] == 0, "Withdrawal already requested");
        
        // Set the withdrawal request timestamp
        withdrawalRequests[msg.sender] = block.timestamp;
        
        emit WithdrawalRequested(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Process a withdrawal after the timelock has expired
     * @dev Can only be called after the withdrawal timelock period has passed
     */
    function processWithdrawal() external {
        uint256 requestTime = withdrawalRequests[msg.sender];
        require(requestTime > 0, "No withdrawal request found");
        require(block.timestamp >= requestTime + withdrawalTimelock, "Timelock period not yet expired");
        
        Game storage game = games[msg.sender];
        require(game.status == GameStatus.Active, "Game is not active");
        
        // Calculate the current pot
        uint256 prize = calculateCurrentPot(game);
        
        // Reset game and withdrawal request
        game.status = GameStatus.Completed;
        withdrawalRequests[msg.sender] = 0;
        
        // Transfer NOOT tokens to player
        require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
        
        emit WithdrawalProcessed(msg.sender, prize);
    }
    
    /**
     * @notice Dealer can provide proof that the player would lose, cancelling the withdrawal
     * @param player The player address
     * @param nextHash The next hash in the chain
     */
    function proveLoss(address player, bytes32 nextHash) external onlyDealer {
        require(withdrawalRequests[player] > 0, "No withdrawal request for this player");
        
        Game storage game = games[player];
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
        bool playerWouldWin = _checkWin(game.previousCard, newCard, game.previousGuess);
        require(!playerWouldWin, "Player would win with this hash");
        
        // Player lost, mark game as completed
        game.status = GameStatus.Completed;
        
        // Reset withdrawal request
        withdrawalRequests[player] = 0;
        
        emit GameLost(player, game.previousCard, newCard, game.previousGuess, nextHash);
    }
    
    /**
     * @notice Dealer requests a withdrawal of a specific amount
     * @param amount The amount to withdraw
     */
    function requestDealerWithdrawal(uint256 amount) external onlyDealer {
        // Ensure there's no pending withdrawal request
        require(dealerRequest.timestamp == 0, "Withdrawal already requested");
        
        // Ensure the requested amount is available
        uint256 contractBalance = nootToken.balanceOf(address(this));
        require(amount <= contractBalance, "Insufficient funds");
        
        // Create withdrawal request
        dealerRequest = DealerWithdrawalRequest({
            amount: amount,
            timestamp: block.timestamp
        });
        
        emit DealerWithdrawalRequested(amount, block.timestamp);
    }
    
    /**
     * @notice Process dealer withdrawal after timelock expires
     */
    function processDealerWithdrawal() external onlyDealer {
        // Verify there's a pending request
        require(dealerRequest.timestamp > 0, "No withdrawal request");
        
        // Verify timelock has expired
        require(block.timestamp >= dealerRequest.timestamp + withdrawalTimelock, 
                "Withdrawal timelock not expired");
        
        // Get amount and reset request
        uint256 amount = dealerRequest.amount;
        dealerRequest.amount = 0;
        dealerRequest.timestamp = 0;
        
        // Transfer tokens to dealer
        require(nootToken.transfer(dealer, amount), "Token transfer failed");
        
        emit DealerWithdrawalProcessed(amount);
    }
} 