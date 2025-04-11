// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

// Simple interface for mock random provider
interface IMockRandomProvider {
    function getRandomNumber() external view returns (uint256);
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
    }
    
    address public admin;
    IERC20 public nootToken;
    IMockRandomProvider public mockRandomProvider;
    uint256 public minWager;
    uint256 public maxWager;
    uint8 public maxTurns = 10;
    uint256 public multiplier = 125; // 1.25x represented as 125/100
    
    mapping(address => Game) public games;
    
    event GameStarted(address indexed player, uint256 wager, Card firstCard, uint8 turns);
    event RoundWon(address indexed player, Card previousCard, Card newCard, Guess guess, uint8 turnsLeft);
    event GameLost(address indexed player, Card previousCard, Card newCard, Guess guess);
    event GameWon(address indexed player, uint256 prize);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event RandomProviderUpdated(address indexed previousProvider, address indexed newProvider);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "NootLadder: caller is not the admin");
        _;
    }
    
    constructor(address _nootToken, address _mockRandomProvider, uint256 _minWager, uint256 _maxWager) {
        require(_nootToken != address(0), "NootLadder: token address cannot be zero");
        require(_mockRandomProvider != address(0), "NootLadder: random provider cannot be zero");
        
        admin = msg.sender; // Deployer is the default admin
        nootToken = IERC20(_nootToken);
        mockRandomProvider = IMockRandomProvider(_mockRandomProvider);
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
        emit RandomProviderUpdated(address(mockRandomProvider), newProvider);
        mockRandomProvider = IMockRandomProvider(newProvider);
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
    
    // Get a random card (0-12) for the 13 cards
    function _getRandomCard() internal view returns (Card) {
        uint256 randomValue;
        try mockRandomProvider.getRandomNumber() returns (uint256 value) {
            randomValue = value;
        } catch {
            // Fallback randomness if provider fails
            randomValue = uint256(keccak256(abi.encodePacked(
                block.timestamp,
                block.prevrandao,
                msg.sender,
                blockhash(block.number - 1)
            )));
        }
        return Card(randomValue % 13);
    }
    
    function startGame(uint256 wagerAmount, uint8 turns) external {
        require(turns > 0, "Turns must be greater than zero");
        require(turns <= maxTurns, "Turns cannot exceed maxTurns");
        require(wagerAmount >= minWager, "Wager too small");
        require(wagerAmount <= maxWager, "Wager too large");
        require(!games[msg.sender].active, "Game already in progress");
        
        // Transfer NOOT tokens from player to contract
        require(nootToken.transferFrom(msg.sender, address(this), wagerAmount), "Token transfer failed");
        
        // Get a random card using our helper function
        Card firstCard = _getRandomCard();
        
        // Initialize the game
        games[msg.sender] = Game({
            player: msg.sender,
            wager: wagerAmount,
            currentPot: wagerAmount,
            currentCard: firstCard,
            turnsLeft: turns,
            totalTurns: turns,
            active: true
        });
        
        emit GameStarted(msg.sender, wagerAmount, firstCard, turns);
    }
    
    function playRound(Guess guess) external {
        Game storage game = games[msg.sender];
        
        require(game.active, "No active game");
        require(game.turnsLeft > 0, "No turns left");
        
        // Get a random card using our helper function
        Card newCard = _getRandomCard();
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
            
            emit RoundWon(msg.sender, previousCard, newCard, guess, game.turnsLeft);
            
            // If player has completed all rounds, they win the game
            if (game.turnsLeft == 0) {
                uint256 prize = game.currentPot;
                game.active = false;
                game.currentPot = 0;
                
                // Transfer NOOT tokens from contract to winner
                require(nootToken.transfer(msg.sender, prize), "Token transfer failed");
                
                emit GameWon(msg.sender, prize);
            }
        } else {
            game.active = false;
            game.currentPot = 0;
            
            emit GameLost(msg.sender, previousCard, newCard, guess);
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
        uint8 totalTurns
    ) {
        Game storage game = games[msg.sender];
        return (
            game.active,
            game.wager,
            game.currentPot,
            game.currentCard,
            game.turnsLeft,
            game.totalTurns
        );
    }
    
    // Allow admin to withdraw any NOOT tokens accidentally sent to the contract
    function withdrawTokens(uint256 amount) external onlyAdmin {
        require(nootToken.transfer(admin, amount), "Token transfer failed");
    }
}