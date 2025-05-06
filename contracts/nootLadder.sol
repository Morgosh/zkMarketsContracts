// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title NootLadder - High/Low Card Game with Provably Fair Randomness
 * @notice This version uses a hash chain and commitment scheme for provably fair card generation
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract NootLadder {
    enum Card { Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace }
    enum Guess { Higher, Lower }
    
    struct Game {
        address player;
        uint256 wager;
        uint256 currentPot;
        Card previousCard;
        Guess previousGuess;
        uint8 totalTurns;
        bool active;
        uint8 turn;
        uint256 gameId;
        bytes32 commitment;
        bytes32 currentHash;
        bytes32 userRandomNonce;
        bool disputeInProgress;
        bool seedRevealed;
    }
    
    address public admin;
    address public dealer;
    IERC20 public nootToken;
    uint256 public minWager;
    uint256 public maxWager;
    uint8 public maxTurns = 10;
    uint256 public disputeTimeLock = 1 days;
    
    // New round-based multipliers
    uint256[10] public roundMultipliers = [
        110, // Round 1: 1.10x
        112, // Round 2: 1.12x
        114, // Round 3: 1.14x
        116, // Round 4: 1.16x
        118, // Round 5: 1.18x
        120, // Round 6: 1.20x
        122, // Round 7: 1.22x
        124, // Round 8: 1.24x
        126, // Round 9: 1.26x
        130  // Round 10: 1.30x
    ];
    
    uint256 public gameCounter = 0;
    
    mapping(address => Game) public games;
    mapping(uint256 => bytes32) public gameCommitments;
    mapping(uint256 => bytes32) public revealedSecrets;
    mapping(uint256 => uint256) public disputeTimeouts;
    
    event GameStarted(address indexed player, uint256 wager, uint8 turns, uint256 gameId, bytes32 commitment);
    event RoundWon(address indexed player, Card previousCard, Card newCard, Guess guess, uint8 turnsLeft);
    event GameLost(address indexed player, Card previousCard, Card newCard, Guess guess);
    event GameWon(address indexed player, uint256 prize);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event DealerTransferred(address indexed previousDealer, address indexed newDealer);
    event CommitmentSubmitted(uint256 indexed gameId, bytes32 commitment);
    event SeedRevealed(uint256 indexed gameId, bytes32 privateSecret);
    event DisputeInitiated(uint256 indexed gameId, address indexed player);
    event DisputeResolved(uint256 indexed gameId, address indexed player, bool playerWon);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NootLadder: caller is not the admin");
        _;
    }
    
    modifier onlyDealer() {
        require(msg.sender == dealer, "NootLadder: caller is not the dealer");
        _;
    }
    
    constructor(address _nootToken, address _dealer, uint256 _minWager, uint256 _maxWager) {
        require(_nootToken != address(0), "NootLadder: token address cannot be zero");
        require(_dealer != address(0), "NootLadder: dealer cannot be zero");
        
        admin = msg.sender; // Deployer is the default admin
        dealer = _dealer; // Trusted dealer who provides the private secrets
        nootToken = IERC20(_nootToken);
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "NootLadder: new admin is the zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
    
    function transferDealer(address newDealer) external onlyAdmin {
        require(newDealer != address(0), "NootLadder: new dealer is the zero address");
        emit DealerTransferred(dealer, newDealer);
        dealer = newDealer;
    }
    
    function updateWagerLimits(uint256 _minWager, uint256 _maxWager) external onlyAdmin {
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function updateRoundMultipliers(uint256[10] calldata _multipliers) external onlyAdmin {
        roundMultipliers = _multipliers;
    }
    
    function updateMaxTurns(uint8 _maxTurns) external onlyAdmin {
        require(_maxTurns <= 10, "NootLadder: max turns cannot exceed 10");
        maxTurns = _maxTurns;
    }
    
    function updateDisputeTimeLock(uint256 _disputeTimeLock) external onlyAdmin {
        disputeTimeLock = _disputeTimeLock;
    }
    
    // Helper function to get a card from a hash
    function _getCardFromHash(bytes32 hash) internal pure returns (Card) {
        return Card(uint8(uint256(hash) % 13));
    }

    // Internal helper to check win condition
    function _checkWin(Card previousCard, Card newCard, Guess guess) internal pure returns (bool) {
        if (guess == Guess.Higher) {
            return uint8(newCard) > uint8(previousCard);
        } else {
            return uint8(newCard) < uint8(previousCard);
        }
    }
    
    // Submit a commitment for a game (called by dealer or admin)
    function submitCommitment(uint256 gameId, bytes32 commitment) external onlyDealer {
        require(gameCommitments[gameId] == bytes32(0), "NootLadder: commitment already exists");
        gameCommitments[gameId] = commitment;
        emit CommitmentSubmitted(gameId, commitment);
    }
    
    // Reveal the private secret for a completed game
    function revealSeed(uint256 gameId, bytes32 privateSecret) external onlyDealer {
        bytes32 commitment = gameCommitments[gameId];
        require(commitment != bytes32(0), "NootLadder: no commitment for this game");
        require(keccak256(abi.encodePacked(privateSecret)) == commitment, "NootLadder: invalid private secret");
        
        revealedSecrets[gameId] = privateSecret;
        emit SeedRevealed(gameId, privateSecret);
        
        // If there's a dispute for this game, resolve it
        if (disputeTimeouts[gameId] > 0) {
            disputeTimeouts[gameId] = 0;
            // Note: Specific player address handling would be needed here
            // We'll assume the game structure is cleaned up elsewhere
            emit DisputeResolved(gameId, address(0), false);
        }
    }
    
    // Start a game with a dealer commitment
    function startGame(uint256 wagerAmount, uint8 turns, bytes32 commitment, bytes32 userRandomNonce) external {
        require(turns > 0 && turns <= maxTurns, "NootLadder: invalid turn count");
        require(wagerAmount >= minWager, "NootLadder: wager too small");
        require(wagerAmount <= maxWager, "NootLadder: wager too large");
        require(games[msg.sender].active == false, "NootLadder: player already has active game");
        
        // Generate a sequential game ID
        uint256 gameId = gameCounter;
        gameCounter++;
        
        // Store the commitment
        gameCommitments[gameId] = commitment;
        
        // Transfer NOOT tokens from player to contract
        require(nootToken.transferFrom(msg.sender, address(this), wagerAmount), "NootLadder: token transfer failed");
        
        // Initialize the game
        games[msg.sender] = Game({
            player: msg.sender,
            wager: wagerAmount,
            currentPot: wagerAmount,
            previousCard: Card.Two, // Default starting card
            previousGuess: Guess.Higher, // Default
            totalTurns: turns,
            active: true,
            turn: 0,
            gameId: gameId,
            commitment: commitment,
            currentHash: bytes32(0), // Will be set on first move
            userRandomNonce: userRandomNonce,
            disputeInProgress: false,
            seedRevealed: false
        });
        
        emit GameStarted(msg.sender, wagerAmount, turns, gameId, commitment);
    }
    
    // Make a guess with verification of the hash chain
    function makeGuess(bytes32 nextHash, bytes32 proof, Guess newGuess) external {
        Game storage game = games[msg.sender];
        
        require(game.active, "NootLadder: no active game");
        require(game.turn < game.totalTurns, "NootLadder: no turns left");
        require(!game.disputeInProgress, "NootLadder: dispute in progress");
        
        // For first turn, we set up the hash chain
        if (game.turn == 0) {
            // Validate the first hash in the chain
            require(game.currentHash == bytes32(0), "NootLadder: hash chain already initialized");
            
            // Proof should be the dealer's private secret in this case
            require(keccak256(abi.encodePacked(proof)) == game.commitment, "NootLadder: invalid proof for commitment");
            
            // Derive the game seed by combining dealer secret with player entropy
            bytes32 gameSeed = keccak256(abi.encodePacked(proof, game.userRandomNonce, msg.sender));
            
            // Verify nextHash is the first element in our hash chain
            require(keccak256(abi.encodePacked(gameSeed)) == nextHash, "NootLadder: invalid first hash");
            
            // Set the current hash for future verification
            game.currentHash = nextHash;
            
            // Get the initial card
            Card newCard = _getCardFromHash(nextHash);
            game.previousCard = newCard;
            game.previousGuess = newGuess;
            game.turn++;
            
            // Apply first round multiplier (1.10x)
            game.currentPot = (game.currentPot * roundMultipliers[0]) / 100;
            
            emit RoundWon(msg.sender, Card.Two, newCard, Guess.Higher, game.totalTurns - game.turn);
            return;
        }
        
        // For subsequent turns, verify the hash chain
        require(keccak256(abi.encodePacked(nextHash)) == game.currentHash, "NootLadder: invalid hash chain");
        
        // Get the new card from the hash
        Card newCard = _getCardFromHash(nextHash);
        
        // Store values for event emission
        Guess previousGuess = game.previousGuess;
        Card previousCard = game.previousCard;
        
        // Update game state before checking win
        game.currentHash = nextHash;
        game.previousCard = newCard;
        game.previousGuess = newGuess;
        game.turn++;
        
        // Check if the previous guess was correct
        bool won = _checkWin(previousCard, newCard, previousGuess);
        
        if (won) {
            // Apply the correct round multiplier based on the current turn (1-indexed)
            uint256 multiplier = roundMultipliers[game.turn - 1];
            game.currentPot = (game.currentPot * multiplier) / 100;
            
            emit RoundWon(msg.sender, previousCard, newCard, previousGuess, game.totalTurns - game.turn);
            
            // If player has completed all rounds, they win the game
            if (game.turn == game.totalTurns) {
                uint256 prize = game.currentPot;
                game.active = false;
                game.currentPot = 0;
                
                // Transfer NOOT tokens from contract to winner
                require(nootToken.transfer(msg.sender, prize), "NootLadder: token transfer failed");
                
                emit GameWon(msg.sender, prize);
            }
        } else {
            game.active = false;
            game.currentPot = 0;
            
            emit GameLost(msg.sender, previousCard, newCard, previousGuess);
        }
    }
    
    // Claim rewards early (cash out)
    function claimRewards() external {
        Game storage game = games[msg.sender];
        
        require(game.active, "NootLadder: no active game");
        require(game.currentPot > 0, "NootLadder: no rewards to claim");
        require(game.turn >= 2, "NootLadder: must complete at least 2 rounds to cash out");
        
        uint256 prize = game.currentPot;
        game.active = false;
        game.currentPot = 0;
        
        // Transfer NOOT tokens from contract to player
        require(nootToken.transfer(msg.sender, prize), "NootLadder: token transfer failed");
        
        emit GameWon(msg.sender, prize);
    }
    
    // Initiate a dispute if the dealer isn't providing hashes or revealed an incorrect seed
    function initiateDispute() external {
        Game storage game = games[msg.sender];
        
        require(game.active, "NootLadder: no active game");
        require(!game.disputeInProgress, "NootLadder: dispute already in progress");
        
        game.disputeInProgress = true;
        disputeTimeouts[game.gameId] = block.timestamp + disputeTimeLock;
        
        emit DisputeInitiated(game.gameId, msg.sender);
    }
    
    // Resolve a dispute after the timelock expires
    function resolveDispute() external {
        Game storage game = games[msg.sender];
        
        require(game.disputeInProgress, "NootLadder: no dispute in progress");
        require(block.timestamp >= disputeTimeouts[game.gameId], "NootLadder: dispute timelock not expired");
        
        // Check if the seed was revealed
        bytes32 revealedSecret = revealedSecrets[game.gameId];
        if (revealedSecret != bytes32(0)) {
            // Seed was revealed, game continues normally
            game.disputeInProgress = false;
            disputeTimeouts[game.gameId] = 0;
            emit DisputeResolved(game.gameId, msg.sender, false);
            return;
        }
        
        // Seed was not revealed, player wins dispute
        uint256 prize = 0;
        
        // Calculate maximum possible winnings
        uint256 basePot = game.wager;
        for (uint8 i = 0; i < game.totalTurns; i++) {
            basePot = (basePot * roundMultipliers[i]) / 100;
        }
        
        prize = basePot;
        game.active = false;
        game.currentPot = 0;
        game.disputeInProgress = false;
        
        // Transfer NOOT tokens from contract to player
        require(nootToken.transfer(msg.sender, prize), "NootLadder: token transfer failed");
        
        emit DisputeResolved(game.gameId, msg.sender, true);
        emit GameWon(msg.sender, prize);
    }
    
    // Function to view game state (default is caller's state if no address provided)
    function getGameState(address player) external view returns (
        bool active,
        uint256 wager,
        uint256 currentPot,
        Card previousCard,
        uint8 totalTurns,
        uint256 gameId,
        uint8 turn,
        bytes32 commitment,
        bytes32 currentHash,
        bool disputeInProgress
    ) {
        Game storage game = games[player];
        return (
            game.active,
            game.wager,
            game.currentPot,
            game.previousCard,
            game.totalTurns,
            game.gameId,
            game.turn,
            game.commitment,
            game.currentHash,
            game.disputeInProgress
        );
    }
    
    // Allow admin to withdraw any NOOT tokens accidentally sent to the contract
    function withdrawTokens(uint256 amount) external onlyAdmin {
        require(nootToken.transfer(admin, amount), "NootLadder: token transfer failed");
    }
    
    // Verify a hash chain
    function verifyHashChain(bytes32 seed, bytes32 nextHash, uint8 steps) external pure returns (bool) {
        bytes32 currentHash = seed;
        
        for (uint8 i = 0; i < steps; i++) {
            currentHash = keccak256(abi.encodePacked(currentHash));
        }
        
        return currentHash == nextHash;
    }
    
    // Verify the full game seed derivation
    function verifyGameSeed(
        bytes32 privateSecret, 
        bytes32 userRandomNonce, 
        address player, 
        bytes32 expectedGameSeed
    ) external pure returns (bool) {
        bytes32 calculatedGameSeed = keccak256(abi.encodePacked(privateSecret, userRandomNonce, player));
        return calculatedGameSeed == expectedGameSeed;
    }
    
    // Verify that a private secret matches a commitment
    function verifyCommitment(bytes32 privateSecret, bytes32 commitment) external pure returns (bool) {
        return keccak256(abi.encodePacked(privateSecret)) == commitment;
    }
}