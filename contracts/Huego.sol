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

contract Huego {
    using SafeERC20 for IERC20;

    uint8 constant GRID_SIZE = 8;
    uint256 constant TIME_LIMIT = 600; // 10 minutes per player
    address public owner;
    uint256 public feePercentage = 500; // 5%

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

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

    struct GameGrid {
        topStack[8][8] grid;
    }
    // GameSession ID -> [game0, game1] -> 8x8 grid
    mapping(uint256 => GameGrid[2]) private stacksGrid;
    GameSession[] public gameSessions; // List of gameSessions

    // Colors: 0 = empty, 1 = yellow, 2 = purple, 3 = orange, 4 = green
    enum Rotation {X, Z, Y}

    function proposeWager(uint256 sessionId, uint256 _amount) external payable {
        // only player 1 or 2 can propose a wager
        require(msg.sender == gameSessions[sessionId].player1 || msg.sender == gameSessions[sessionId].player2, "Not a player of this game");
        require(msg.value == _amount, "Wager amount does not match");
        wagerProposals[msg.sender][sessionId] = WagerProposal({
            sessionId: sessionId,
            amount: _amount
        });
    }
    function cancelWagerProposal(uint256 sessionId) external {
        require(wagerProposals[msg.sender][sessionId].amount != 0, "No wager proposal exists");
        // refund the player
        payable(msg.sender).transfer(wagerProposals[msg.sender][sessionId].amount);
        delete wagerProposals[msg.sender][sessionId];
    }
    function acceptWagerProposal(uint256 sessionId, uint256 _amount) external payable {
        address proposer = (msg.sender == gameSessions[sessionId].player1) ? gameSessions[sessionId].player2 : gameSessions[sessionId].player1;
        require(wagerProposals[proposer][sessionId].amount != 0, "No wager proposal exists");
        // require that the player pays the wager
        require(msg.value == wagerProposals[proposer][sessionId].amount, "Wager amount does not match");
        require(!gameSessions[sessionId].wager.processed, "Wager already processed");
        // amount must match so it prevents frontrunning
        require(_amount == wagerProposals[proposer][sessionId].amount, "Wager amount does not match");
        gameSessions[sessionId].wager.amount += wagerProposals[msg.sender][sessionId].amount;
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
    }

    function createSession(address player1, address player2, uint8 x, uint8 z) external {
        uint256 sessionId = gameSessions.length;
        GameSession storage session = gameSessions.push();
        session.player1 = player1;
        session.player2 = player2;
        session.wager = WagerInfo(0, false);
        session.turn = 2;
        session.game = 0;
        session.gameStartTime = block.timestamp;
        session.lastMoveTime = block.timestamp;
        session.timeRemainingP1 = TIME_LIMIT;
        session.timeRemainingP2 = TIME_LIMIT;
        session.gameEnded = false;

        // **Fix:** Initialize `initialStacks` before adding elements
        session.initialStacks.push(); // First game session
        session.initialStacks.push(); // Second game session

        placeInitial4x1Stack(sessionId, 0, x, z, 1);
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
        }
        // requirement that the player still has time
        if (onTurn == session.player1) {
            require(block.timestamp - session.lastMoveTime < session.timeRemainingP1, "Player 1 ran out of time");
            session.timeRemainingP1 -= block.timestamp - session.lastMoveTime;
        } else {
            require(block.timestamp - session.lastMoveTime < session.timeRemainingP2, "Player 2 ran out of time");
            session.timeRemainingP2 -= block.timestamp - session.lastMoveTime;
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

    // SCORING
    // • Base Points: 1 point for each cube on top of any stack
    // • Bonus Points: +1 point for cubes on the highest and lowest VISIBLE stacks
    // • GameSession ends when all cubes are placed or when a player runs out of time
    function calculateGamePoints(uint256 sessionId, uint8 game) public view returns (uint256, uint256) {
        require(gameSessions[sessionId].gameEnded, "GameSession has not ended yet");

        uint256 player1Points = 0;
        uint256 player2Points = 0;

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
                    player1Points += 2;
                } else {
                    player2Points += 2;
                }
            } else {
                if (stack.color == 1 || stack.color == 3) {
                    player1Points += 1;
                } else {
                    player2Points += 1;
                }
            }
        }

        return (player1Points, player2Points);
    }

    // receive reward
    function acceptRewards(uint256 sessionId) external {
        GameSession storage session = gameSessions[sessionId];
        require(!session.wager.processed, "Wager already processed");
        address winner;
        uint256 pot = session.wager.amount * 2;
        uint256 fee = pot * feePercentage / 10000;
        uint256 reward = pot - fee;
        if(session.game == 1 && session.turn == 28) {
            uint256 totalPlayer1Points = 0;
            uint256 totalPlayer2Points = 0;

            for (uint8 game = 0; game < 2; game++) {
                (uint256 player1Points, uint256 player2Points) = calculateGamePoints(sessionId, game);
                totalPlayer1Points += player1Points;
                totalPlayer2Points += player2Points;
            }
            if (totalPlayer1Points > totalPlayer2Points) {  
                winner = session.player1;
            } else if (totalPlayer2Points > totalPlayer1Points) {
                winner = session.player2;
            } else {
                // Tie case, refund wager to both players
                session.wager.processed = true;
                payable(session.player1).transfer(reward/2);
                payable(session.player2).transfer(reward/2);
                return;
            }
        } else {
            address starter = session.game == 0 ? session.player1 : session.player2;
            address nonStarter = session.game == 0 ? session.player2 : session.player1;
            address onTurn = session.turn % 2 == 1 ? starter : nonStarter;
            // if not turn 28, game has not ended, we can calculate the winner one player runs out of time
            if (onTurn == session.player1) {
                require(block.timestamp - session.lastMoveTime > session.timeRemainingP1, "Player 1 still has time");
                winner = session.player2;
            } else {
                require(block.timestamp - session.lastMoveTime > session.timeRemainingP2, "Player 2 still has time");
                winner = session.player1;
            }
        }
        session.wager.processed = true;
        payable(winner).transfer(reward);
    }

    function setFee(uint256 _feePercentage) external onlyOwner {
        require(_feePercentage <= 1000, "Fee too high"); // Max 10%
        feePercentage = _feePercentage;
    }

    function withdrawERC20(IERC20 erc20Token) external onlyOwner {
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(msg.sender, erc20Balance);
    }

    function withdrawETH() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        payable(msg.sender).transfer(ethBalance);
    }
}