// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

// Interface for the VRF
interface IRandomProvider {
    function requestRandomness(address consumer) external returns (bytes32, uint256);
}

contract NootLadder {
    enum Card { Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace }
    enum Guess { Higher, Lower }
    
    struct Game {
        address player;
        uint256 wager;
        uint256 currentPot;
        Card currentCard;
        uint8 turnsLeft;
        uint8 totalTurns;
        bool active;
        bytes32 pendingRequestId; // For tracking randomness requests
    }
    
    address public admin;
    IERC20 public nootToken;
    IRandomProvider public randomProvider;
    uint256 public minWager;
    uint256 public maxWager;
    uint8 public maxTurns = 10;
    uint256 public multiplier = 125; // 1.25x represented as 125/100
    
    mapping(address => Game) public games;
    mapping(bytes32 => address) public requestIdToPlayer; // Map request IDs to players
    mapping(bytes32 => Guess) public requestIdToGuess; // Map request IDs to guesses
    
    event GameStarted(address indexed player, uint256 wager, Card firstCard, uint8 turns);
    event RoundWon(address indexed player, Card previousCard, Card newCard, Guess guess, uint8 turnsLeft);
    event GameLost(address indexed player, Card previousCard, Card newCard, Guess guess);
    event GameWon(address indexed player, uint256 prize);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event RandomProviderUpdated(address indexed previousProvider, address indexed newProvider);
    event RandomnessRequested(bytes32 indexed requestId, address indexed player);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "NootLadder: caller is not the admin");
        _;
    }
    
    constructor(address _nootToken, address _randomProvider, uint256 _minWager, uint256 _maxWager) {
        require(_nootToken != address(0), "NootLadder: token address cannot be zero");
        require(_randomProvider != address(0), "NootLadder: random provider cannot be zero");
        
        admin = msg.sender; // Deployer is the default admin
        nootToken = IERC20(_nootToken);
        randomProvider = IRandomProvider(_randomProvider);
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "NootLadder: new admin is the zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
    
    function updateRandomProvider(address newProvider) external onlyAdmin {
        require(newProvider != address(0), "NootLadder: new provider cannot be zero address");
        emit RandomProviderUpdated(address(randomProvider), newProvider);
        randomProvider = IRandomProvider(newProvider);
    }
    
    function updateWagerLimits(uint256 _minWager, uint256 _maxWager) external onlyAdmin {
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function updateMultiplier(uint256 _multiplier) external onlyAdmin {
        multiplier = _multiplier;
    }
    
    function updateMaxTurns(uint8 _maxTurns) external onlyAdmin {
        maxTurns = _maxTurns;
    }
    
    function startGame(uint256 wagerAmount, uint8 turns) external {
        require(turns > 0, "Turns must be greater than zero");
        require(turns <= maxTurns, "Turns cannot exceed maxTurns");
        require(wagerAmount >= minWager, "Wager too small");
        require(wagerAmount <= maxWager, "Wager too large");
        require(!games[msg.sender].active, "Game already in progress");
        
        // Transfer NOOT tokens from player to contract
        require(nootToken.transferFrom(msg.sender, address(this), wagerAmount), "Token transfer failed");
        
        // Request randomness for the first card
        bytes32 requestId = _drawCard();
        
        // Initialize the game with a placeholder card (will be updated in fulfillRandomness)
        games[msg.sender] = Game({
            player: msg.sender,
            wager: wagerAmount,
            currentPot: wagerAmount,
            currentCard: Card.Two, // Placeholder, will be updated by VRF
            turnsLeft: turns,
            totalTurns: turns,
            active: true,
            pendingRequestId: requestId
        });
        
        // Store the requestId mapping to start game
        requestIdToPlayer[requestId] = msg.sender;
        
        emit RandomnessRequested(requestId, msg.sender);
    }

    function _drawCard() internal returns (bytes32 requestId) {
        // Request randomness for the first card
        (requestId,) = randomProvider.requestRandomness(address(this));
        return requestId;
    }
    
    function playRound(Guess guess) external {
        Game storage game = games[msg.sender];
        
        require(game.active, "No active game");
        require(game.turnsLeft > 0, "No turns left");
        require(game.pendingRequestId == bytes32(0), "Randomness request already pending");
        
        // Request randomness for the next card
        bytes32 requestId = _drawCard();
        
        // Store the request ID and guess for processing in the callback
        game.pendingRequestId = requestId;
        requestIdToPlayer[requestId] = msg.sender;
        requestIdToGuess[requestId] = guess;
        
        emit RandomnessRequested(requestId, msg.sender);
    }
    
    // Callback function for VRF
    function fulfillRandomness(bytes32 requestId, uint256 randomness) external {
        require(msg.sender == address(randomProvider), "Only VRF can fulfill");
        
        address player = requestIdToPlayer[requestId];
        require(player != address(0), "Unknown request ID");
        
        Game storage game = games[player];
        
        // Clear the request state
        game.pendingRequestId = bytes32(0);
        delete requestIdToPlayer[requestId];
        
        // Get the guess associated with this request
        Guess guess = requestIdToGuess[requestId];
        delete requestIdToGuess[requestId];
        
        // Generate a card from the randomness (0-12 for the 13 cards)
        Card newCard = Card(randomness % 13);
        
        // Check if this is a game start request (special value 255)
        if (game.turnsLeft == game.totalTurns) {
            // This is a start game request, just set the card and emit event
            game.currentCard = newCard;
            emit GameStarted(player, game.wager, newCard, game.totalTurns);
            return;
        }
        
        // Otherwise, this is a round play
        Card previousCard = game.currentCard;
        bool won = false;
        
        if (guess == Guess.Higher) {
            won = uint8(newCard) > uint8(previousCard);
        } else {
            won = uint8(newCard) < uint8(previousCard);
        }
        
        if (won) {
            game.currentPot = (game.currentPot * multiplier) / 100;
            game.currentCard = newCard;
            game.turnsLeft--;
            
            emit RoundWon(player, previousCard, newCard, guess, game.turnsLeft);
            
            // If player has completed all rounds, they win the game
            if (game.turnsLeft == 0) {
                uint256 prize = game.currentPot;
                game.active = false;
                game.currentPot = 0;
                
                // Transfer NOOT tokens from contract to winner
                require(nootToken.transfer(player, prize), "Token transfer failed");
                
                emit GameWon(player, prize);
            }
        } else {
            game.active = false;
            game.currentPot = 0;
            
            emit GameLost(player, previousCard, newCard, guess);
        }
    }
    
    /**
     * @notice Allows a player to claim their current pot and end the game early
     * @dev Player will get their current pot and the game will be marked as inactive
     */
    function claimRewards() external {
        Game storage game = games[msg.sender];
        
        require(game.active, "No active game");
        require(game.currentPot > 0, "No rewards to claim");
        require(game.pendingRequestId == bytes32(0), "Randomness request pending");
        
        uint256 prize = game.currentPot;
        game.active = false;
        game.currentPot = 0;
        
        // Transfer NOOT tokens from contract to player
        require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
        
        emit GameWon(msg.sender, prize);
    }
    
    // Function to view game state
    function getGameState() external view returns (
        bool active,
        uint256 wager,
        uint256 currentPot,
        Card currentCard,
        uint8 turnsLeft,
        uint8 totalTurns,
        bytes32 pendingRequestId
    ) {
        Game storage game = games[msg.sender];
        return (
            game.active,
            game.wager,
            game.currentPot,
            game.currentCard,
            game.turnsLeft,
            game.totalTurns,
            game.pendingRequestId
        );
    }
    
    // Allow admin to withdraw any NOOT tokens accidentally sent to the contract
    function withdrawTokens(uint256 amount) external onlyAdmin {
        require(nootToken.transfer(admin, amount), "Token transfer failed");
    }
}