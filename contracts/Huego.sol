// there are 2 gameSessions played per session
// first 4 turns are placing 4x1 blocks flat
// next 24 turns are placing 2x1 blocks any rotation
// at this point game starts another game
// first 4 turns are placing 4x1 blocks flat
// next 24 turns are placing 2x1 blocks any rotation

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract Huego {
    using SafeERC20 for IERC20;

    uint8 constant GRID_SIZE = 8;
    uint256 public timeLimit = 600; // 10 minutes per player
    address public owner;
    uint256 public feePercentage = 500; // 5%
    IERC721 public nftContract;
    uint256 public discountedFeePercentage = 200; // 2% for NFT holders

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    event BlockPlaced(uint256 indexed sessionId, uint8 indexed game, uint8 turn, uint8 pieceType, uint8 x, uint8 z, uint8 y, Rotation rotation);
    event GameSessionCreated(uint256 indexed sessionId, address indexed player1, address indexed player2, uint256 wagerAmount);
    event WagerProposed(address indexed proposer, uint256 indexed sessionId, uint256 amount);
    event WagerAccepted(uint256 indexed sessionId, address indexed player1, address indexed player2, uint256 amount);
    event GameEnded(uint256 indexed sessionId, address indexed winner, address indexed loser, uint256 amount);

    struct WagerInfo {
        uint256 amount;
        bool processed;     // To prevent double-processing
    }

    struct WagerProposal {
        uint256 sessionId;
        uint256 amount;
    }
    
    struct GameSession {
        address player1;
        address player2;
        WagerInfo wager;
        uint8 turn;
        uint8 game; // either 0 or 1
        uint256 gameStartTime;
        uint256 lastMoveTime;
        uint256 timeRemainingP1;
        uint256 timeRemainingP2;
        bool gameEnded;
        // forfeited
        address forfeitedBy;
        topStack[][] initialStacks; // basically [2][16]
    }

    struct topStack {
        uint8 x;
        uint8 z;
        uint8 y;
        uint8 color;
    }

    // wager proposals maps address and sessionId to the wager proposal
    mapping(address => mapping(uint256 => WagerProposal)) public wagerProposals;
    // lets map user to their gameSession
    mapping(address => uint256) public userGameSession;

    struct GameGrid {
        topStack[8][8] grid;
    }
    // GameSession ID -> [game0, game1] -> 8x8 grid
    mapping(uint256 => GameGrid[2]) private stacksGrid;
    GameSession[] public gameSessions; // List of gameSessions

    // Colors: 0 = empty, 1 = yellow, 2 = purple, 3 = orange, 4 = green
    enum Rotation {X, Z, Y}

    constructor() {
        owner = msg.sender;
        // lets create a dummy gameSession to start from 1
        gameSessions.push();
    }

    function getInitialStacks(uint256 sessionId, uint8 game) public view returns (topStack[] memory) {
        return gameSessions[sessionId].initialStacks[game];
    }
    function getStacksGrid(uint256 sessionId, uint8 game) public view returns (topStack[8][8] memory) {
        return stacksGrid[sessionId][game].grid;
    }

    function getPlayerActiveSession(address player) public view returns (uint256) {
        uint256 sessionId = userGameSession[player];

        if (sessionId == 0) {
            return 0;
        }

        GameSession storage session = gameSessions[sessionId];

        if (session.gameEnded) {
            return 0;
        }

        if (session.forfeitedBy != address(0)) {
            return 0;
        }

        address starter = session.game == 0 ? session.player1 : session.player2;
        address nonStarter = session.game == 0 ? session.player2 : session.player1;
        address playerOnTurn = session.turn % 2 == 1 ? starter : nonStarter;

        uint256 currentPlayerTimeRemaining = (playerOnTurn == session.player1)
            ? session.timeRemainingP1
            : session.timeRemainingP2;

        bool currentPlayerHasTime = block.timestamp - session.lastMoveTime <= currentPlayerTimeRemaining;

        return currentPlayerHasTime ? sessionId : 0;
    }

    function proposeWager(uint256 sessionId, uint256 _amount) external payable {
        require(msg.value == _amount, "Wager amount mismatch");
        _proposeWager(sessionId, _amount, msg.sender);
    }

    function acceptWagerProposal(uint256 sessionId, uint256 _amount) external payable {
        require(msg.value == _amount, "Wager amount mismatch");
        _acceptWager(sessionId, _amount, msg.sender);
    }

    function acceptAndProposeWager(uint256 sessionId, uint256 _acceptAmount, uint256 _proposeAmount) external payable {
        require(msg.value == _acceptAmount + _proposeAmount, "Wager amount mismatch");
        _acceptWager(sessionId, _acceptAmount, msg.sender);
        _proposeWager(sessionId, _proposeAmount, msg.sender);
    }

    // Internal helper functions to reduce redundancy
    function _proposeWager(uint256 sessionId, uint256 _amount, address sender) internal {
        require(sender == gameSessions[sessionId].player1 || sender == gameSessions[sessionId].player2, "Not a player of this game");
        uint currentWagerAmount = wagerProposals[sender][sessionId].amount;
        wagerProposals[sender][sessionId] = WagerProposal({
            sessionId: sessionId,
            amount: _amount
        });

        if (currentWagerAmount != 0) {
            (bool success,) = payable(sender).call{value: currentWagerAmount}("");
            require(success, "Refund failed");
        }
        
        emit WagerProposed(sender, sessionId, _amount);
    }

    function _acceptWager(uint256 sessionId, uint256 _amount, address sender) internal {
        address proposer = (sender == gameSessions[sessionId].player1) ? gameSessions[sessionId].player2 : gameSessions[sessionId].player1;
        require(_amount == wagerProposals[proposer][sessionId].amount, "Wager amount mismatch");
        require(wagerProposals[proposer][sessionId].amount != 0, "No wager proposal");
        require(!gameSessions[sessionId].wager.processed, "Wager already processed");

        gameSessions[sessionId].wager.amount += wagerProposals[proposer][sessionId].amount;
        delete wagerProposals[proposer][sessionId];
        
        emit WagerAccepted(sessionId, gameSessions[sessionId].player1, gameSessions[sessionId].player2, _amount);
    }

    function cancelWagerProposal(uint256 sessionId) external {
        require(wagerProposals[msg.sender][sessionId].amount != 0, "No wager proposal exists");
        // refund the player
        (bool success,) = payable(msg.sender).call{value: wagerProposals[msg.sender][sessionId].amount}("");
        require(success, "Transfer failed");
        delete wagerProposals[msg.sender][sessionId];
    }
    
    function placeInitial4x1Stack(uint256 sessionId, uint8 game, uint8 x, uint8 z, uint8 color) internal {
        require(game < 2, "Invalid game index");
        require(x + 1 < GRID_SIZE && z + 1 < GRID_SIZE, "Invalid coordinates");

        require(stacksGrid[sessionId][game].grid[x][z].color == 0, "Grid has a stack");
        require(stacksGrid[sessionId][game].grid[x + 1][z].color == 0, "Grid has a stack");
        require(stacksGrid[sessionId][game].grid[x][z + 1].color == 0, "Grid has a stack");
        require(stacksGrid[sessionId][game].grid[x + 1][z + 1].color == 0, "Grid has a stack");

        topStack memory stack1 = topStack(x, z, 0, color);
        topStack memory stack2 = topStack(x + 1, z, 0, color);
        topStack memory stack3 = topStack(x, z + 1, 0, color);
        topStack memory stack4 = topStack(x + 1, z + 1, 0, color);

        // If it's not the first placement, check for a valid neighbor
        if (gameSessions[sessionId].turn > 1) {
            // Predefined offsets for the 8 unique neighboring positions
            int8[8] memory dx = [ int8(-1), int8(-1), int8(0), int8(0), int8(2), int8(2), int8(0), int8(1)];
            int8[8] memory dz = [ int8(0), int8(1), int8(2), int8(2), int8(0), int8(1), int8(-1), int8(-1)];

            bool found = false;
            for (uint8 i = 0; i < 8; i++) {
                int8 nx = int8(x) + dx[i];
                int8 nz = int8(z) + dz[i];

                // Ensure within grid bounds before checking
                if (nx >= 0 && nx < int8(GRID_SIZE) && nz >= 0 && nz < int8(GRID_SIZE)) {
                    if (stacksGrid[sessionId][game].grid[uint8(nx)][uint8(nz)].color != 0) {
                        found = true;
                        break;
                    }
                }
            }
            require(found, "No adjacent stack");
        }

        stacksGrid[sessionId][game].grid[x][z] = stack1;
        stacksGrid[sessionId][game].grid[x + 1][z] = stack2;
        stacksGrid[sessionId][game].grid[x][z + 1] = stack3;
        stacksGrid[sessionId][game].grid[x + 1][z + 1] = stack4;

        // Calculate the correct index in initialStacks based on turn
        // uint8 turnIndex = (gameSessions[sessionId].turn - 1) * 4; // Each turn places 4 blocks

        gameSessions[sessionId].initialStacks[game].push(stack1);
        gameSessions[sessionId].initialStacks[game].push(stack2);
        gameSessions[sessionId].initialStacks[game].push(stack3);
        gameSessions[sessionId].initialStacks[game].push(stack4);

        emit BlockPlaced(sessionId, game, gameSessions[sessionId].turn, 1, x, z, 0, Rotation.X);
    }

    function createSession(address player1, address player2) external {
        // only player 1 can create a session
        require(msg.sender == player2, "Not player 2");
        // player 1 and 2 must not have an active game
        require(getPlayerActiveSession(player1) == 0, "Player 1 has an active session");
        require(getPlayerActiveSession(player2) == 0, "Player 2 has an active session");

        uint256 sessionId = gameSessions.length;
        GameSession storage session = gameSessions.push();
        session.player1 = player1;
        session.player2 = player2;
        session.wager = WagerInfo(0, false);
        session.game = 0;
        session.gameStartTime = block.timestamp;
        session.lastMoveTime = block.timestamp;
        session.timeRemainingP1 = timeLimit + 5; // Extra 5 seconds for player 1
        session.timeRemainingP2 = timeLimit;
        session.gameEnded = false;

        // **Fix:** Initialize `initialStacks` before adding elements
        session.initialStacks.push(); // First game session
        session.initialStacks.push(); // Second game session

        userGameSession[player1] = sessionId;
        userGameSession[player2] = sessionId;
        session.turn = 1;
        
        emit GameSessionCreated(sessionId, player1, player2, 0);
    }

    function play(uint256 sessionId, uint8 x, uint8 z, Rotation rotation) external {
        GameSession storage session = gameSessions[sessionId];
        // game must not have ended
        require(!session.gameEnded, "GameSession has ended");
        // only player on turn can play
        address starter = session.game == 0 ? session.player1 : session.player2;
        address nonStarter = session.game == 0 ? session.player2 : session.player1;
        address onTurn = session.turn % 2 == 1 ? starter : nonStarter;
        require(msg.sender == onTurn, "Not your turn");
        uint8 currentColor = ((session.turn - 1) % 4) + 1;
        // requirement that the player still has time
        if (onTurn == session.player1) {
            require(block.timestamp - session.lastMoveTime < session.timeRemainingP1, "Player 1 ran out of time");
            session.timeRemainingP1 -= block.timestamp - session.lastMoveTime;
        } else {
            require(block.timestamp - session.lastMoveTime < session.timeRemainingP2, "Player 2 ran out of time");
            session.timeRemainingP2 -= block.timestamp - session.lastMoveTime;
        }

        // we are placing initial stacks
        if(session.turn <= 4) {
            placeInitial4x1Stack(sessionId, session.game, x, z, currentColor);
        } else {
            placeBlock(sessionId, session.game, x, z, currentColor);
            if (rotation == Rotation.X) {
                require(checkStackWithColorExists(sessionId, session.game, currentColor), "No stack with color exists");
                placeBlock(sessionId, session.game, x + 1, z, currentColor);
            } else if (rotation == Rotation.Z) {
                require(checkStackWithColorExists(sessionId, session.game, currentColor), "No stack with color exists");
                placeBlock(sessionId, session.game, x, z + 1, currentColor);
            } else {
                placeBlock(sessionId, session.game, x, z, currentColor);
            }
            // game ends on turn 28
            if (session.turn == 28) {
                if(session.game == 0) {
                    session.game = 1;
                    session.turn = 0;
                } else {
                    session.gameEnded = true;
                }
            }
            emit BlockPlaced(sessionId, session.game, session.turn, 2, x, z, stacksGrid[sessionId][session.game].grid[x][z].y, rotation);
        }
        session.lastMoveTime = block.timestamp;
        session.turn += 1;
    }

    function checkStackWithColorExists(uint256 sessionId, uint8 game, uint8 color) internal view returns (bool) {
        for (uint8 i = 0; i < 16; i++) {
            if (stacksGrid[sessionId][game].grid[gameSessions[sessionId].initialStacks[game][i].x][gameSessions[sessionId].initialStacks[game][i].z].color == color) {
                return true;
            }
        }
        return false;
    }

    function placeBlock(uint256 sessionId, uint8 game, uint8 x, uint8 z, uint8 currentColor) internal {
        require(stacksGrid[sessionId][game].grid[x][z].color != 0, "Stack does not exist");

        stacksGrid[sessionId][game].grid[x][z].y += 1;
        stacksGrid[sessionId][game].grid[x][z].color = currentColor;
    }

    function forfeit(uint256 sessionId) external {
        GameSession storage session = gameSessions[sessionId];
        require(!session.gameEnded, "GameSession has ended");
        if (msg.sender == session.player1) {
            session.forfeitedBy = session.player1;
        } else if (msg.sender == session.player2) {
            session.forfeitedBy = session.player2;
        } else {
            revert("Not a player of this game");
        }
    }

    // SCORING
    // • Base Points: 1 point for each cube on top of any stack
    // • Bonus Points: +1 point for cubes on the highest and lowest VISIBLE stacks
    // • GameSession ends when all cubes are placed or when a player runs out of time
    function calculateGamePoints(uint256 sessionId, uint8 game) public view returns (uint256, uint256) {
        uint256 starterPoints = 0;
        uint256 nonStarterPoints = 0;

        uint8 highestStack = 0;
        // first lets loop to find the highest stack
        for (uint8 i = 0; i < 16; i++) {
            uint x = gameSessions[sessionId].initialStacks[game][i].x;
            uint z = gameSessions[sessionId].initialStacks[game][i].z;

            topStack memory stack = stacksGrid[sessionId][game].grid[x][z];
            if (stack.y > highestStack) {
                highestStack = stack.y;
            }
        }

        uint lowestStack = highestStack;
        // now lets loop to find the lowest stack
        for (uint8 i = 0; i < 16; i++) {
            uint x = gameSessions[sessionId].initialStacks[game][i].x;
            uint z = gameSessions[sessionId].initialStacks[game][i].z;

            topStack memory stack = stacksGrid[sessionId][game].grid[x][z];
            if (stack.y < lowestStack) {
                lowestStack = stack.y;
            }
        }

        for (uint8 i = 0; i < 16; i++) {
            uint x = gameSessions[sessionId].initialStacks[game][i].x;
            uint z = gameSessions[sessionId].initialStacks[game][i].z;

            topStack memory stack = stacksGrid[sessionId][game].grid[x][z];
            if (stack.y == highestStack || stack.y == lowestStack) {
                // color 1 and color 3 belong to player 1
                if (stack.color == 1 || stack.color == 3) {
                    starterPoints += 2;
                } else {
                    nonStarterPoints += 2;
                }
            } else {
                if (stack.color == 1 || stack.color == 3) {
                    starterPoints += 1;
                } else {
                    nonStarterPoints += 1;
                }
            }
        }

        return (starterPoints, nonStarterPoints);
    }

    // receive reward
    function acceptRewards(uint256 sessionId) external {
        GameSession storage session = gameSessions[sessionId];
        require(!session.wager.processed, "Wager already processed");
        session.wager.processed = true;
        address winner;
        // if forfeited
        if(session.forfeitedBy != address(0)) {
            winner = session.forfeitedBy == session.player1 ? session.player2 : session.player1;
        } else if(session.game == 1 && session.turn == 29 && session.gameEnded) {
            uint256 totalPlayer1Points = 0;
            uint256 totalPlayer2Points = 0;

            (uint256 starterPoints0, uint256 nonStarterPoints0) = calculateGamePoints(sessionId, 0);
            (uint256 starterPoints1, uint256 nonStarterPoints1) = calculateGamePoints(sessionId, 1);
            totalPlayer1Points += starterPoints0;
            totalPlayer2Points += nonStarterPoints0;
            totalPlayer1Points += nonStarterPoints1;
            totalPlayer2Points += starterPoints1;
            if (totalPlayer1Points > totalPlayer2Points) {
                winner = session.player1;
                emit GameEnded(sessionId, session.player1, session.player2, session.wager.amount * 2);
            } else if (totalPlayer2Points > totalPlayer1Points) {
                winner = session.player2;
                emit GameEnded(sessionId, session.player2, session.player1, session.wager.amount * 2);
            } else {
                // require either player1, player2 
                require(msg.sender == session.player1 || msg.sender == session.player2, "Not a player of this game");
                // Tie case, refund wager to both players
                uint256 feeEach;
                if (address(nftContract) != address(0) && nftContract.balanceOf(msg.sender) > 0) {
                    feeEach = session.wager.amount * discountedFeePercentage / 10000;
                } else {
                    feeEach = session.wager.amount * feePercentage / 10000;
                }
                uint256 rewardSplit = session.wager.amount - feeEach;
                (bool success1,) = payable(session.player1).call{value: rewardSplit}("");
                require(success1, "Transfer failed");
                (bool success2,) = payable(session.player2).call{value: rewardSplit}("");
                require(success2, "Transfer failed");
                (bool success3,) = payable(owner).call{value: 2 * feeEach}("");
                require(success3, "Transfer failed");
                emit GameEnded(sessionId, address(0), address(0), session.wager.amount * 2); // address(0) indicates a tie
                return;
            }
        } else {
            // lets throw require current turn is 29
            address starter = session.game == 0 ? session.player1 : session.player2;
            address nonStarter = session.game == 0 ? session.player2 : session.player1;
            address onTurn = session.turn % 2 == 1 ? starter : nonStarter;
            // if not turn 28, game has not ended, we can calculate the winner one player runs out of time
            if (onTurn == session.player1) {
                require(block.timestamp - session.lastMoveTime > session.timeRemainingP1, "Player 1 still has time");
                winner = session.player2;
                emit GameEnded(sessionId, session.player2, session.player1, session.wager.amount * 2);
            } else {
                require(block.timestamp - session.lastMoveTime > session.timeRemainingP2, "Player 2 still has time");
                winner = session.player1;
                emit GameEnded(sessionId, session.player1, session.player2, session.wager.amount * 2);
            }
        }
        // caller has to be the winner
        require(msg.sender == winner, "Not the winner");
        uint256 pot = session.wager.amount * 2;
        uint256 fee;
        
        // Check if winner holds NFT and discount is enabled
        if (address(nftContract) != address(0) && nftContract.balanceOf(winner) > 0) {
            fee = pot * discountedFeePercentage / 10000;
        } else {
            fee = pot * feePercentage / 10000;
        }
        
        uint256 reward = pot - fee;
        (bool success4,) = payable(winner).call{value: reward}("");
        require(success4, "Transfer failed");
        (bool success5,) = payable(owner).call{value: fee}("");
        require(success5, "Transfer failed");
    }

    function setFeePercentage(uint256 _feePercentage) external onlyOwner {
        require(_feePercentage <= 1000, "Fee too high"); // Max 10%
        feePercentage = _feePercentage;
    }

    function setGameTimeLimit(uint256 _timeLimit) external onlyOwner {
        timeLimit = _timeLimit;
    }

    function setNftContract(address _nftContract) external onlyOwner {
        require(address(nftContract) == address(0), "NFT contract already set");
        require(_nftContract != address(0), "Invalid NFT contract address");
        nftContract = IERC721(_nftContract);
    }

    function disableNftDiscount() external onlyOwner {
        nftContract = IERC721(address(0));
    }

    // if funds are stuck on contract for some reason
    function withdrawERC20(IERC20 erc20Token) external onlyOwner {
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(msg.sender, erc20Balance);
    }

    // if funds are stuck on contract for some reason
    function withdraw(uint256 amount) external onlyOwner {
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
    }
}