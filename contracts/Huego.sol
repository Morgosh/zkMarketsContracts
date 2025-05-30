// SPDX-License-Identifier: MIT

/// @custom:security-contact huego.xyz@gmail.com
/// @custom:security-contact X (Project): @huege_io
/// @custom:security-contact X (Dev): @0xmorgosh

// there are 2 gameSessions played per session
// first 4 turns are placing 2x2 blocks flat
// next 24 turns are placing 2x1 blocks any rotation
// at this point game starts another game
// first 4 turns are placing 2x2 blocks flat
// next 24 turns are placing 2x1 blocks any rotation

pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Huego {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    uint8 constant GRID_SIZE = 8;
    uint256 public timeLimit = 600; // 10 minutes per player
    address public owner;
    uint256 public feePercentage = 500; // 5%
    uint256 public discountedFeePercentage = 200; // 2% for NFT holders
    uint256 public extraTimeForPlayer1 = 5; // Extra seconds for player 1
    IERC721 public nftContract;
    
    // Game constants
    uint8 constant FINAL_TURN = 28; // Last turn of each game round
    uint8 constant INITIAL_TURNS = 4; // Number of turns for placing initial 2x2 blocks
    uint8 constant BASE_POINTS = 1; // Base points for each block
    uint8 constant BONUS_POINTS = 2; // Bonus points for highest/lowest stacks
    uint16 constant BASIS_POINTS = 10000; // 100% in basis points
    uint16 constant MAX_FEE_PERCENTAGE = 1000; // Maximum fee: 10% in basis points
    uint8 constant MAX_EXTRA_TIME = 60; // Maximum extra time for player 1 in seconds
    
    // Player colors (yellow=1, orange=3 belong to starter; purple=2, green=4 belong to non-starter)
    uint8 constant PLAYER_COLOR_1 = 1; // Yellow
    uint8 constant PLAYER_COLOR_2 = 3; // Orange

    // Maximum time window for a player to use a signature after it's created
    // Player2 must create the game within 1 minute of player1 signing the message
    uint256 public constant SIGNATURE_VALIDITY_PERIOD = 60; // 60 seconds = 1 minute

    // Predefined offsets for the 8 unique neighboring positions
    int8[GRID_SIZE] private DX;
    int8[GRID_SIZE] private DZ;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    modifier validGameSession(uint256 sessionId) {
        require(sessionId > 0 && sessionId < gameSessions.length, "Invalid session ID");
        _;
    }

    event BlockPlaced(uint256 indexed sessionId, uint8 indexed game, uint8 turn, PieceType pieceType, uint8 x, uint8 z, Rotation rotation);
    event GameSessionCreated(uint256 indexed sessionId, address indexed player1, address indexed player2);
    event WagerProposed(address indexed proposer, uint256 indexed sessionId, uint256 amount);
    event WagerAccepted(uint256 indexed sessionId, address indexed player1, address indexed player2, uint256 amount);
    event WagerCancelled(address indexed proposer, uint256 indexed sessionId);
    event GameEnded(uint256 indexed sessionId, address indexed winner, address indexed loser, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeePercentagesUpdated(uint256 feePercentage, uint256 discountedFeePercentage);
    event GameTimeLimitUpdated(uint256 timeLimit);
    event NftContractUpdated(address indexed nftContract);
    event ExtraTimeForPlayer1Updated(uint256 extraTime);
    event ERC20Withdrawn(address indexed token, uint256 amount);
    event ETHWithdrawn(uint256 amount);

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
        GameRound game; // either FIRST or SECOND
        uint256 gameStartTime;
        uint256 lastMoveTime;
        uint256 timeRemainingP1;
        uint256 timeRemainingP2;
        bool gameEnded;
        // forfeited
        address forfeitedBy;
        mapping(GameRound => topStack[]) initialStacks;
        uint256 feePercentageAtCreation;
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
    // mapping to track withdrawable funds for each user (for failed transfers)
    mapping(address => uint256) public withdrawableBalance;

    struct GameGrid {
        topStack[GRID_SIZE][GRID_SIZE] grid;
    }
    // GameSession ID -> GameRound -> 8x8 grid
    mapping(uint256 => mapping(GameRound => GameGrid)) private stacksGrid;
    GameSession[] public gameSessions; // List of gameSessions

    // Colors: 0 = empty, 1 = yellow, 2 = purple, 3 = orange, 4 = green
    enum Rotation {X, Z, Y}
    enum GameRound {FIRST, SECOND}
    enum PieceType {TWO_BY_TWO_BLOCK, TWO_BY_ONE_BLOCK}

    // Mapping to track used signatures
    mapping(bytes32 => bool) public usedSignatures;

    constructor() {
        owner = msg.sender;
        // lets create a dummy gameSession to start from 1
        gameSessions.push();
        
        // Initialize the array variables
        DX = [int8(-1), int8(-1), int8(0), int8(1), int8(2), int8(2), int8(0), int8(1)];
        DZ = [int8(0), int8(1), int8(2), int8(2), int8(0), int8(1), int8(-1), int8(-1)];
    }

    function getInitialStacks(uint256 sessionId, GameRound game) external view validGameSession(sessionId) returns (topStack[] memory) {
        return gameSessions[sessionId].initialStacks[game];
    }
    function getStacksGrid(uint256 sessionId, GameRound game) external view validGameSession(sessionId) returns (topStack[GRID_SIZE][GRID_SIZE] memory) {
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

        address playerOnTurn = _getPlayerOnTurn(sessionId);

        uint256 currentPlayerTimeRemaining = (playerOnTurn == session.player1)
            ? session.timeRemainingP1
            : session.timeRemainingP2;

        bool currentPlayerHasTime = block.timestamp - session.lastMoveTime <= currentPlayerTimeRemaining;

        return currentPlayerHasTime ? sessionId : 0;
    }

    function getPlayerTimeLeft(uint256 sessionId, address player) external view validGameSession(sessionId) returns (uint256) {
        GameSession storage session = gameSessions[sessionId];
        address playerOnTurn = _getPlayerOnTurn(sessionId);

        if (player == playerOnTurn) {
            uint256 elapsedTime = block.timestamp - session.lastMoveTime;
            uint256 remainingTime = (player == session.player1) ? session.timeRemainingP1 : session.timeRemainingP2;
            return (remainingTime > elapsedTime) ? remainingTime - elapsedTime : 0;
        } else {
            return (player == session.player1) ? session.timeRemainingP1 : session.timeRemainingP2;
        }
    }

    function getPlayerOnTurn(uint256 sessionId) external view validGameSession(sessionId) returns (address) {
        return _getPlayerOnTurn(sessionId);
    }

    function _getPlayerOnTurn(uint256 sessionId) internal view returns (address) {
        GameSession storage session = gameSessions[sessionId];
        address starter = session.game == GameRound.FIRST ? session.player1 : session.player2;
        address nonStarter = session.game == GameRound.FIRST ? session.player2 : session.player1;
        return session.turn % 2 == 1 ? starter : nonStarter;
    }

    function proposeWager(uint256 sessionId) external payable validGameSession(sessionId) {
        require(msg.value > 0, "Wager amount must be greater than 0");
        require(getPlayerActiveSession(msg.sender) == sessionId, "Game has already ended");
        require(msg.sender == gameSessions[sessionId].player1 || msg.sender == gameSessions[sessionId].player2, "Not a player of this game");
        address otherPlayer = (msg.sender == gameSessions[sessionId].player1) ? gameSessions[sessionId].player2 : gameSessions[sessionId].player1;
        
        uint256 currentWagerAmount = wagerProposals[msg.sender][sessionId].amount;
        uint256 otherPlayerWagerAmount = wagerProposals[otherPlayer][sessionId].amount;
        
        // Update state before external calls
        delete wagerProposals[otherPlayer][sessionId];
        wagerProposals[msg.sender][sessionId] = WagerProposal({
            sessionId: sessionId,
            amount: msg.value
        });
        
        emit WagerProposed(msg.sender, sessionId, msg.value);
        
        // INTERACTIONS - Perform external calls last to prevent reentrancy
        if (currentWagerAmount != 0) {
            (bool success,) = payable(msg.sender).call{value: currentWagerAmount}("");
            require(success, "Refund failed");
        }
        
        if (otherPlayerWagerAmount != 0) {
            (bool success,) = payable(otherPlayer).call{value: otherPlayerWagerAmount}("");
            require(success, "Refund to other player failed");
        }
    }

    function acceptWagerProposal(uint256 sessionId) external payable validGameSession(sessionId) {
        require(getPlayerActiveSession(msg.sender) == sessionId, "Game has already ended");
        require(msg.sender == gameSessions[sessionId].player1 || msg.sender == gameSessions[sessionId].player2, "Not a player of this game");
        address proposer = (msg.sender == gameSessions[sessionId].player1) ? gameSessions[sessionId].player2 : gameSessions[sessionId].player1;
        require(msg.value == wagerProposals[proposer][sessionId].amount, "Wager amount mismatch");
        require(wagerProposals[proposer][sessionId].amount != 0, "No wager proposal");
        require(!gameSessions[sessionId].wager.processed, "Wager already processed");

        gameSessions[sessionId].wager.amount += wagerProposals[proposer][sessionId].amount;
        delete wagerProposals[proposer][sessionId];
        
        emit WagerAccepted(sessionId, gameSessions[sessionId].player1, gameSessions[sessionId].player2, msg.value);
    }

    function cancelWagerProposal(uint256 sessionId) external validGameSession(sessionId) {
        require(wagerProposals[msg.sender][sessionId].amount != 0, "No wager proposal exists");
        uint256 amountToRefund = wagerProposals[msg.sender][sessionId].amount;
        delete wagerProposals[msg.sender][sessionId];
        // refund the player
        (bool success,) = payable(msg.sender).call{value: amountToRefund}("");
        require(success, "Transfer failed");
        emit WagerCancelled(msg.sender, sessionId);
    }
    
    function _placeInitial2x2Stack(uint256 sessionId, GameRound game, uint8 x, uint8 z, uint8 color) internal {
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
            bool found = false;
            for (uint8 i = 0; i < GRID_SIZE; i++) {
                int8 nx = int8(x) + DX[i];
                int8 nz = int8(z) + DZ[i];

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

        gameSessions[sessionId].initialStacks[game].push(stack1);
        gameSessions[sessionId].initialStacks[game].push(stack2);
        gameSessions[sessionId].initialStacks[game].push(stack3);
        gameSessions[sessionId].initialStacks[game].push(stack4);

        emit BlockPlaced(sessionId, uint8(game), gameSessions[sessionId].turn, PieceType.TWO_BY_TWO_BLOCK, x, z, Rotation.X);
    }

    function getSessionMessageHash(address player1, address player2, uint256 timestamp) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "Create Huego Game Session", 
            player1, 
            player2, 
            timestamp,
            address(this),  // Contract address to prevent cross-contract replay
            block.chainid   // Chain ID to prevent cross-chain replay
        ));
    }

    function createSession(address player1, address player2, uint256 timestamp, bytes memory signature) external {
        // only player 2 can create a session
        require(msg.sender == player2, "Not player 2");
        // player 1 and 2 must be different
        require(player1 != player2, "Players must be different");
        // player 1 and 2 must not have an active game
        require(getPlayerActiveSession(player1) == 0, "Player 1 has an active session");
        require(getPlayerActiveSession(player2) == 0, "Player 2 has an active session");
        
        // Verify timestamp is valid and within the allowed time window (1 minute)
        require(timestamp <= block.timestamp, "Timestamp is from the future");
        require(block.timestamp <= timestamp + SIGNATURE_VALIDITY_PERIOD, "Signature expired (must use within 1 minute)");
        
        // Create message hash
        bytes32 messageHash = getSessionMessageHash(player1, player2, timestamp);
        
        // Prepend the Ethereum signed message prefix
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        
        // Verify signature hasn't been used
        require(!usedSignatures[ethSignedMessageHash], "Signature already used");
        
        // Recover signer address
        address signer = ECDSA.recover(ethSignedMessageHash, signature);
        require(signer == player1, "Invalid signature");
        
        // Mark signature as used
        usedSignatures[ethSignedMessageHash] = true;

        uint256 sessionId = gameSessions.length;
        GameSession storage session = gameSessions.push();
        session.player1 = player1;
        session.player2 = player2;
        session.wager = WagerInfo(0, false);
        session.game = GameRound.FIRST;
        session.gameStartTime = block.timestamp;
        session.lastMoveTime = block.timestamp;
        session.timeRemainingP1 = timeLimit + extraTimeForPlayer1;
        session.timeRemainingP2 = timeLimit;
        session.gameEnded = false;
        
        // Store the fee percentage based on NFT ownership at creation time
        if (address(nftContract) != address(0) && 
            (nftContract.balanceOf(player1) > 0 || nftContract.balanceOf(player2) > 0)) {
            session.feePercentageAtCreation = discountedFeePercentage;
        } else {
            session.feePercentageAtCreation = feePercentage;
        }

        userGameSession[player1] = sessionId;
        userGameSession[player2] = sessionId;
        session.turn = 1;
        
        emit GameSessionCreated(sessionId, player1, player2);
    }

    function play(uint256 sessionId, uint8 x, uint8 z, Rotation rotation) external validGameSession(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        // game must not have ended
        require(!session.gameEnded, "GameSession has ended");
        // game must not have been forfeited
        require(session.forfeitedBy == address(0), "Game has been forfeited");
        // only player on turn can play
        address onTurn = _getPlayerOnTurn(sessionId);
        require(msg.sender == onTurn, "Not your turn");
        uint8 currentColor = ((session.turn - 1) % 4) + 1;
        // requirement that the player still has time
        if (onTurn == session.player1) {
            require(block.timestamp - session.lastMoveTime <= session.timeRemainingP1, "Player 1 ran out of time");
            session.timeRemainingP1 -= block.timestamp - session.lastMoveTime;
        } else {
            require(block.timestamp - session.lastMoveTime <= session.timeRemainingP2, "Player 2 ran out of time");
            session.timeRemainingP2 -= block.timestamp - session.lastMoveTime;
        }

        // we are placing initial stacks
        if(session.turn <= INITIAL_TURNS) {
            _placeInitial2x2Stack(sessionId, session.game, x, z, currentColor);
        } else {
            if (rotation == Rotation.X) {
                require(_checkStackWithColorExists(sessionId, session.game, currentColor), "No stack with color exists");
                _placeBlock(sessionId, session.game, x + 1, z, currentColor);
            } else if (rotation == Rotation.Z) {
                require(_checkStackWithColorExists(sessionId, session.game, currentColor), "No stack with color exists");
                _placeBlock(sessionId, session.game, x, z + 1, currentColor);
            } else {
                _placeBlock(sessionId, session.game, x, z, currentColor);
            }
            _placeBlock(sessionId, session.game, x, z, currentColor); // place initial block must be done last due to stack color check
            
            // Emit event before state changes to ensure correct values
            emit BlockPlaced(sessionId, uint8(session.game), session.turn, PieceType.TWO_BY_ONE_BLOCK, x, z, rotation);
            
            // game ends on final turn
            if (session.turn == FINAL_TURN) {
                if(session.game == GameRound.FIRST) {
                    session.game = GameRound.SECOND;
                    session.turn = 0;
                } else {
                    session.gameEnded = true;
                }
            }
        }
        session.lastMoveTime = block.timestamp;
        session.turn += 1;
    }

    function _checkStackWithColorExists(uint256 sessionId, GameRound game, uint8 color) internal view returns (bool) {
        uint256 stackCount = gameSessions[sessionId].initialStacks[game].length;
        for (uint256 i = 0; i < stackCount; i++) {
            if (stacksGrid[sessionId][game].grid[gameSessions[sessionId].initialStacks[game][i].x][gameSessions[sessionId].initialStacks[game][i].z].color == color) {
                return true;
            }
        }
        return false;
    }

    function _placeBlock(uint256 sessionId, GameRound game, uint8 x, uint8 z, uint8 currentColor) internal {
        require(x < GRID_SIZE && z < GRID_SIZE, "Invalid coordinates");
        require(stacksGrid[sessionId][game].grid[x][z].color != 0, "Stack does not exist");

        stacksGrid[sessionId][game].grid[x][z].y += 1;
        stacksGrid[sessionId][game].grid[x][z].color = currentColor;
    }

    function forfeit(uint256 sessionId) external validGameSession(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        // you can only forfeit an active session
        require(getPlayerActiveSession(msg.sender) == sessionId, "Not an active session");
        if (msg.sender == session.player1) {
            session.forfeitedBy = session.player1;
        } else if (msg.sender == session.player2) {
            session.forfeitedBy = session.player2;
        } else {
            revert("Not a player of this game");
        }
    }

    function calculateGamePoints(uint256 sessionId, GameRound game) external view validGameSession(sessionId) returns (uint256, uint256) {
        return _calculateGamePoints(sessionId, game);
    }

    // SCORING
    // • Base Points: 1 point for each cube on top of any stack
    // • Bonus Points: +1 point for cubes on the highest and lowest VISIBLE stacks
    // • GameSession ends when all cubes are placed or when a player runs out of time
    function _calculateGamePoints(uint256 sessionId, GameRound game) internal view returns (uint256, uint256) {
        uint256 starterPoints = 0;
        uint256 nonStarterPoints = 0;

        // Get the actual number of placed stacks (may be less than 16 during first 4 turns)
        uint256 stackCount = gameSessions[sessionId].initialStacks[game].length;
        
        // If no stacks placed yet, return zero points
        if (stackCount == 0) {
            return (0, 0);
        }

        uint8 highestStack = 0;
        uint8 lowestStack = type(uint8).max; // Initialize to maximum possible value

        // Single loop to find both highest and lowest stacks - use actual stack count
        for (uint256 i = 0; i < stackCount; i++) {
            topStack memory stack = stacksGrid[sessionId][game].grid[gameSessions[sessionId].initialStacks[game][i].x][gameSessions[sessionId].initialStacks[game][i].z];
            
            // Find highest stack
            if (stack.y > highestStack) {
                highestStack = stack.y;
            }
            
            // Find lowest stack
            if (stack.y < lowestStack) {
                lowestStack = stack.y;
            }
        }

        // Calculate points based on highest and lowest stacks - use actual stack count
        for (uint256 i = 0; i < stackCount; i++) {
            topStack memory stack = stacksGrid[sessionId][game].grid[gameSessions[sessionId].initialStacks[game][i].x][gameSessions[sessionId].initialStacks[game][i].z];
            
            // Match original logic: check high/low first, then default
            if (stack.y == highestStack || stack.y == lowestStack) {
                // color 1 and color 3 belong to player 1
                if (stack.color == PLAYER_COLOR_1 || stack.color == PLAYER_COLOR_2) {
                    starterPoints += BONUS_POINTS;
                } else {
                    nonStarterPoints += BONUS_POINTS;
                }
            } else {
                if (stack.color == PLAYER_COLOR_1 || stack.color == PLAYER_COLOR_2) {
                    starterPoints += BASE_POINTS;
                } else {
                    nonStarterPoints += BASE_POINTS;
                }
            }
        }

        return (starterPoints, nonStarterPoints);
    }

    // receive reward
    function acceptRewards(uint256 sessionId) external validGameSession(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        require(!session.wager.processed, "Wager already processed");
        session.wager.processed = true;
        address winner;
        // if forfeited
        if(session.forfeitedBy != address(0)) {
            winner = session.forfeitedBy == session.player1 ? session.player2 : session.player1;
            emit GameEnded(sessionId, winner, session.forfeitedBy, session.wager.amount * 2);
        } else if(session.game == GameRound.SECOND && session.turn > FINAL_TURN && session.gameEnded) {
            uint256 totalPlayer1Points = 0;
            uint256 totalPlayer2Points = 0;

            (uint256 starterPoints0, uint256 nonStarterPoints0) = _calculateGamePoints(sessionId, GameRound.FIRST);
            (uint256 starterPoints1, uint256 nonStarterPoints1) = _calculateGamePoints(sessionId, GameRound.SECOND);
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
                uint256 feeEach = session.wager.amount * session.feePercentageAtCreation / BASIS_POINTS;
                uint256 rewardSplit = session.wager.amount - feeEach;
                
                // Try direct transfers to players, fallback to withdrawable balance on failure
                (bool success1,) = payable(session.player1).call{value: rewardSplit}("");
                if (!success1) {
                    withdrawableBalance[session.player1] += rewardSplit;
                }
                
                (bool success2,) = payable(session.player2).call{value: rewardSplit}("");
                if (!success2) {
                    withdrawableBalance[session.player2] += rewardSplit;
                }
                
                // Always transfer directly to owner (no fallback)
                (bool success3,) = payable(owner).call{value: 2 * feeEach}("");
                require(success3, "Owner transfer failed");
                emit GameEnded(sessionId, address(0), address(0), session.wager.amount * 2); // address(0) indicates a tie
                return;
            }
        } else {
            address onTurn = _getPlayerOnTurn(sessionId);
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
        uint256 fee = pot * session.feePercentageAtCreation / BASIS_POINTS;
        uint256 reward = pot - fee;
        (bool success4,) = payable(winner).call{value: reward}("");
        require(success4, "Winner transfer failed");
        (bool success5,) = payable(owner).call{value: fee}("");
        require(success5, "Owner transfer failed");
    }

    function claimRewards() external {
        uint256 amount = withdrawableBalance[msg.sender];
        require(amount > 0, "No rewards to claim");
        
        // Update state before external call to prevent reentrancy
        withdrawableBalance[msg.sender] = 0;
        
        // Transfer the funds
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit RewardsClaimed(msg.sender, amount);
    }

    function setFeePercentages(uint256 _feePercentage, uint256 _discountedFeePercentage) external onlyOwner {
        require(_feePercentage <= MAX_FEE_PERCENTAGE, "Fee too high"); // Max 10%
        require(_discountedFeePercentage <= _feePercentage, "Discounted fee must be lower or equal to normal fee");
        feePercentage = _feePercentage;
        discountedFeePercentage = _discountedFeePercentage;
        emit FeePercentagesUpdated(feePercentage, discountedFeePercentage);
    }

    function setGameTimeLimit(uint256 _timeLimit) external onlyOwner {
        timeLimit = _timeLimit;
        emit GameTimeLimitUpdated(timeLimit);
    }

    function setNftContract(address _nftContract) external onlyOwner {
        nftContract = IERC721(_nftContract);
        emit NftContractUpdated(_nftContract);
    }
    function setExtraTimeForPlayer1(uint256 _extraTime) external onlyOwner {
        require(_extraTime <= MAX_EXTRA_TIME, "Extra time too high"); // Max 60 seconds extra
        extraTimeForPlayer1 = _extraTime;
        emit ExtraTimeForPlayer1Updated(extraTimeForPlayer1);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // if funds are stuck on contract for some reason
    function withdrawERC20(IERC20 erc20Token) external onlyOwner {
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(msg.sender, erc20Balance);
        emit ERC20Withdrawn(address(erc20Token), erc20Balance);
    }

    // if funds are stuck on contract for some reason
    function withdraw(uint256 amount) external onlyOwner {
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        emit ETHWithdrawn(amount);
    }
}