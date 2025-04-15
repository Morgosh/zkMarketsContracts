// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

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
    }
    
    address public admin;
    address public trustedSigner;
    IERC20 public nootToken;
    uint256 public minWager;
    uint256 public maxWager;
    uint8 public maxTurns = 10;
    uint256 public multiplier = 125; // 1.25x represented as 125/100
    uint256 public gameCounter = 0;
    
    mapping(address => Game) public games;
    
    event GameStarted(address indexed player, uint256 wager, uint8 turns, uint256 gameId);
    event RoundWon(address indexed player, Card previousCard, Card newCard, Guess guess, uint8 turnsLeft);
    event GameLost(address indexed player, Card previousCard, Card newCard, Guess guess);
    event GameWon(address indexed player, uint256 prize);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event FirstCardRevealed(address indexed player, Card firstCard);
    event GuessMade(address indexed player, Guess guess);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "NootLadder: caller is not the admin");
        _;
    }
    
    constructor(address _nootToken, address _trustedSigner, uint256 _minWager, uint256 _maxWager) {
        require(_nootToken != address(0), "NootLadder: token address cannot be zero");
        require(_trustedSigner != address(0), "NootLadder: trusted signer cannot be zero");
        
        admin = msg.sender; // Deployer is the default admin
        nootToken = IERC20(_nootToken);
        trustedSigner = _trustedSigner;
        minWager = _minWager;
        maxWager = _maxWager;
    }
    
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "NootLadder: new admin is the zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
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
    
    // Get a card from the signature
    function getCardFromSignature(bytes memory signature) external pure returns (Card) {
        (bytes32 r, bytes32 s, ) = _splitSignature(signature);
        // Use only r and s to generate the card, ignoring v
        bytes32 signatureHash = keccak256(abi.encodePacked(r, s));
        return Card(uint8(uint256(signatureHash) % 13));
    }
    
    // Verify the signature and return the card
    function _verifySignatureAndGetCard(
        uint256 gameId,
        address player,
        uint8 turnNumber,
        bytes memory signature
    ) internal view returns (Card) {
        // Create the message hash that was signed
        bytes32 messageHash = keccak256(abi.encodePacked(gameId, player, turnNumber));
        
        // Get the ethereum signed message hash
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        // Recover the signer from the signature
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recoveredSigner = ecrecover(ethSignedMessageHash, v, r, s);
        
        require(recoveredSigner == trustedSigner, "NootLadder: invalid signature");
        
        // Get a card from the signature using only r and s components
        bytes32 cardHash = keccak256(abi.encodePacked(r, s));
        return Card(uint8(uint256(cardHash) % 13));
    }
    
    // Helper function to split signature into r, s, v components
    function _splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "NootLadder: invalid signature length");
        
        assembly {
            // first 32 bytes
            r := mload(add(sig, 32))
            // next 32 bytes
            s := mload(add(sig, 64))
            // final byte (first byte of the next 32 bytes)
            v := byte(0, mload(add(sig, 96)))
        }
        
        // 27 or 28 for eth
        require(v == 27 || v == 28, "NootLadder: only v=27 or v=28 signatures are accepted");
        return (r, s, v);
    }
    
    function startGame(uint256 wagerAmount, uint8 turns) external {
        require(turns > 0, "Turns must be greater than zero");
        require(turns <= maxTurns, "Turns cannot exceed maxTurns");
        require(wagerAmount >= minWager, "Wager too small");
        require(wagerAmount <= maxWager, "Wager too large");
        
        // Generate a sequential game ID
        uint256 gameId = gameCounter;
        gameCounter++;
        
        // Transfer NOOT tokens from player to contract
        require(nootToken.transferFrom(msg.sender, address(this), wagerAmount), "Token transfer failed");
        
        // Initialize the game
        games[msg.sender] = Game({
            player: msg.sender,
            wager: wagerAmount,
            currentPot: wagerAmount,
            previousCard: Card.Two,
            previousGuess: Guess.Higher,
            totalTurns: turns,
            active: true,
            turn: 0,
            gameId: gameId
        });
        
        emit GameStarted(msg.sender, wagerAmount, turns, gameId);
    }
    
    // Resolve the round with a new card from signature
    function makeGuess(bytes memory signature, Guess newGuess) external {
        Game storage game = games[msg.sender];
        
        require(game.active, "No active game");
        require(game.turn < game.totalTurns, "No turns left");
        
        // Get the current round number for the signature
        uint8 currentTurn = game.turn + 1;
        
        // Verify signature and get the new card
        Card newCard = _verifySignatureAndGetCard(
            game.gameId,
            msg.sender,
            currentTurn,
            signature
        );
        
        Guess previousGuess = game.previousGuess;
        Card previousCard = game.previousCard;

        game.previousCard = newCard;
        game.previousGuess = newGuess;

        game.turn++;
        // if turn is 1 we don't need to check the guess
        if (game.turn == 1) {
            return;
        }

        // Check if the previous guess was correct
        bool won = false;
        
        if (previousGuess == Guess.Higher) {
            won = uint8(newCard) > uint8(previousCard);
        } else {
            won = uint8(newCard) < uint8(previousCard);
        }
        
        if (won) {
            game.currentPot = (game.currentPot * multiplier) / 100;
            
            emit RoundWon(msg.sender, previousCard, newCard, previousGuess, game.totalTurns - game.turn);
            
            // If player has completed all rounds, they win the game
            if (game.turn == game.totalTurns) {
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
            
            emit GameLost(msg.sender, previousCard, newCard, previousGuess);
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
    
    // Function to view game state (default is caller's state if no address provided)
    function getGameState(address player) external view returns (
        bool active,
        uint256 wager,
        uint256 currentPot,
        Card previousCard,
        uint8 totalTurns,
        uint256 gameId,
        uint8 turn
    ) {
        Game storage game = games[player];
        return (
            game.active,
            game.wager,
            game.currentPot,
            game.previousCard,
            game.totalTurns,
            game.gameId,
            game.turn
        );
    }
    
    // Allow admin to withdraw any NOOT tokens accidentally sent to the contract
    function withdrawTokens(uint256 amount) external onlyAdmin {
        require(nootToken.transfer(admin, amount), "Token transfer failed");
    }
    
    // Function to verify if a signature is valid for a given game round
    function verifySignature(
        uint256 gameId,
        address player,
        uint8 turnNumber,
        bytes memory signature
    ) external view returns (bool) {
        // Create the message hash that was signed
        bytes32 messageHash = keccak256(abi.encodePacked(gameId, player, turnNumber));
        
        // Get the ethereum signed message hash
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        // Recover the signer from the signature
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        address recoveredSigner = ecrecover(ethSignedMessageHash, v, r, s);
        
        return recoveredSigner == trustedSigner;
    }
}