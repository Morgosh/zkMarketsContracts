import { expect } from "chai"
import hre from "hardhat"
import { Contract } from "zksync-ethers"
import huegoABI from "../abis/Huego.abi.json"
import { Signer, ethers } from "ethers"
import { deployContract, getRichWallets, getProvider } from "../utils/utils"

// console.log("deploying on ", hre.network.config)

let contractAddress: string = null!
let richWallets: Signer[] = []
let richWalletsAddresses: string[] = []

async function expectRejectedWithMessage(promise: Promise<any>, message: string, log: boolean = false) {
  try {
    if(log) console.log("running promise")
    const tx = await promise // Wait for transaction submission
    await tx.wait() // Wait for transaction confirmation
    console.log(`Expected to be rejected with message: ${message}`)
    throw new Error(`Expected to be rejected`)
  } catch (error: any) {
    if(log) console.log("promise is caught with message", error.message)
    // console.log(`Rejected with message: ${message}`)
    expect(error.message).to.include(message) // Check if error contains expected message
  }
}

function stringifyBigInts(o: any): string {
  return JSON.stringify(
    (function convert(o: any) {
      if (typeof o === "bigint") return o.toString()
      if (o !== null && typeof o === "object") {
        if (Array.isArray(o)) return o.map(convert)
        return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, convert(v)]))
      }
      return o
    })(o)
  )
}


describe("deploying", function () {
  const provider = getProvider()
  before("init", async () => {
    richWallets = await getRichWallets()
    richWalletsAddresses = await Promise.all(richWallets.map(wallet => wallet.getAddress()))
  })

  let adminContract: Contract
  let player1Contract: Contract
  let player2Contract: Contract
  it("It should deploy", async () => {
    const deployParams: any = []
    adminContract = await deployContract("Huego", deployParams)
    adminContract = new Contract(await adminContract.getAddress(), huegoABI, richWallets[0])
    player1Contract = new Contract(await adminContract.getAddress(), huegoABI, richWallets[1])
    player2Contract = new Contract(await adminContract.getAddress(), huegoABI, richWallets[2])
    contractAddress = await adminContract.getAddress()
    // expect(await adminContract.name()).to.eq(deployParams[0])
    // expect(await adminContract.symbol()).to.eq(deployParams[1])
  })
  it("richWallets[0] interaction works", async () => {
    expect(await adminContract.owner()).to.eq(await richWallets[0].getAddress())
    expect(await adminContract.feePercentage()).to.eq(500n)
    expect(await adminContract.timeLimit()).to.eq(600n)
  })
  it("setting fee and time works", async () => {
    adminContract = new Contract(contractAddress, huegoABI, richWallets[0])
    await adminContract.setFeePercentage(600n)
    await adminContract.setGameTimeLimit(800n)
    expect(await adminContract.feePercentage()).to.eq(600n)
    expect(await adminContract.timeLimit()).to.eq(800n)
    // lets set them back
    await adminContract.setFeePercentage(500n)
    await adminContract.setGameTimeLimit(600n)
  })

  it("createSession", async () => {
    const x = 0
    const z = 0
    const player1 = richWalletsAddresses[1]
    const player2 = richWalletsAddresses[2]
    await expectRejectedWithMessage(player1Contract.createSession(player1, player2), "Not player 2")
    let session = await player2Contract.createSession(player1, player2)
    await session.wait()
    // lets fetch sessionid by userMapping
    const sessionId = await player1Contract.userGameSession(player1)
    const sessionId2 = await player1Contract.userGameSession(player1)
    expect(sessionId).to.eq(1n)
    expect(sessionId).to.eq(sessionId2)
    await expectRejectedWithMessage(player2Contract.createSession(player1, player2), "Player 1 has an active session", true)
  })

  it("letsCheckSessionDetails", async () => {
    // struct GameSession {
    //     address player1;
    //     address player2;
    //     WagerInfo wager;
    //     uint8 turn;
    //     uint8 game; // either 0 or 1
    //     uint256 gameStartTime;
    //     uint256 lastMoveTime;
    //     uint256 timeRemainingP1;
    //     uint256 timeRemainingP2;
    //     bool gameEnded;
    //     topStack[][] initialStacks; // basically [2][16]
    // }
    const session = await player1Contract.gameSessions(1)
    expect(session[0]).to.eq(richWalletsAddresses[1]) // player1
    expect(session[1]).to.eq(richWalletsAddresses[2]) // player2
    expect(session[2][0]).to.eq(0n) // wager is 0
    expect(session[2][1]).to.eq(false) // wager fullfilled is false
    expect(session[3]).to.eq(1n) // turn is 1
    expect(session[4]).to.eq(0n) // game is 0
    expect(session[5]).to.eq(session[6]) // gameStartTime is equal to lastMoveTime
    expect(session[7]).to.eq(605n) // timeRemainingP1
    expect(session[8]).to.eq(600n) // timeRemainingP2
    expect(session[9]).to.eq(false) // gameEnded is false
    // expect(session[10]).to.eq() // initialStacks is in a getter
  })

  it("playing1", async () => {
    const legitMoveTx1 = await player1Contract.play(1, 0, 0, 0)
    await legitMoveTx1.wait()

    // getInitialStacks
    let initialStacks = await player1Contract.getInitialStacks(1,0) // session 1, game 0
    //   struct topStack {
    //     uint8 x;
    //     uint8 z;
    //     uint8 y;
    //     uint8 color;
    // }
    expect(stringifyBigInts(initialStacks[0])).to.eq(stringifyBigInts([0n, 0n, 0n, 1n]))
    expect(stringifyBigInts(initialStacks[1])).to.eq(stringifyBigInts([1n, 0n, 0n, 1n]))
    expect(stringifyBigInts(initialStacks[2])).to.eq(stringifyBigInts([0n, 1n, 0n, 1n]))
    expect(stringifyBigInts(initialStacks[3])).to.eq(stringifyBigInts([1n, 1n, 0n, 1n]))

    await expectRejectedWithMessage(player1Contract.play(1, 0, 0, 0), "Not your turn")
    await expectRejectedWithMessage(player2Contract.play(1, 0, 0, 0), "Grid has a stack")
    await expectRejectedWithMessage(player2Contract.play(1, 1, 0, 0), "Grid has a stack")
    await expectRejectedWithMessage(player2Contract.play(1, 0, 1, 0), "Grid has a stack")
    await expectRejectedWithMessage(player2Contract.play(1, 1, 1, 0), "Grid has a stack")

    await expectRejectedWithMessage(player2Contract.play(1, 7, 7, 0), "Invalid coordinates")

    await expectRejectedWithMessage(player2Contract.play(1, 6, 6, 0), "No adjacent stack")
    await expectRejectedWithMessage(player2Contract.play(1, 2, 2, 0), "No adjacent stack")

    const legitMoveTx2 = await player2Contract.play(1, 2, 0, 0)
    await legitMoveTx2.wait()
    const legitMoveTx3 = await player1Contract.play(1, 4, 0, 0)
    await legitMoveTx3.wait()
    const legitMoveTx4 = await player2Contract.play(1, 0, 2, 0)
    await legitMoveTx4.wait()

    // now they place bets 1 eth
    // function proposeWager(uint256 sessionId, uint256 _amount) external payable {
    await expectRejectedWithMessage(player1Contract.proposeWager(1, ethers.parseEther("2"), { value: ethers.parseEther("1") }), "Wager amount mismatch")
    let proposeWagerTx = await player1Contract.proposeWager(1, ethers.parseEther("1"), { value: ethers.parseEther("1") })
    await proposeWagerTx.wait()
    // if he makes another proposal he can just override it
    proposeWagerTx = await player1Contract.proposeWager(1, ethers.parseEther("2"), { value: ethers.parseEther("2") })
    await proposeWagerTx.wait()
    // balance should be 2 eth
    let contractBalance = await provider.getBalance(contractAddress)
    expect(contractBalance).to.eq(ethers.parseEther("2"))
    // or he can cancel it
    // function cancelWagerProposal(uint256 sessionId) external {
    await player1Contract.cancelWagerProposal(1)
    // now he can make a new proposal
    proposeWagerTx = await player1Contract.proposeWager(1, ethers.parseEther("2"), { value: ethers.parseEther("2") })
    await proposeWagerTx.wait()
    // now player 2 should accept it or make a counter offer
    // function acceptWagerProposal(uint256 sessionId, uint256 _amount) external payable {
    await expectRejectedWithMessage(player2Contract.acceptWagerProposal(1, ethers.parseEther("1"), { value: ethers.parseEther("1") }), "Wager amount mismatch")
    const acceptWagerProposalTx = await player2Contract.acceptWagerProposal(1, ethers.parseEther("2"), { value: ethers.parseEther("2") })
    await acceptWagerProposalTx.wait()

    // now balance on contract should be 4 eth
    contractBalance = await provider.getBalance(contractAddress)
    expect(contractBalance).to.eq(ethers.parseEther("4"))
    const session2 = await player1Contract.gameSessions(1)
    expect(session2[2][0].toString()).to.eq(ethers.parseEther("2").toString()) //balance on wager to be 2

    initialStacks = await player1Contract.getInitialStacks(1,0) // session 1, game 0
    expect(stringifyBigInts(initialStacks[0])).to.eq(stringifyBigInts([0n, 0n, 0n, 1n]))
    expect(stringifyBigInts(initialStacks[1])).to.eq(stringifyBigInts([1n, 0n, 0n, 1n]))
    expect(stringifyBigInts(initialStacks[2])).to.eq(stringifyBigInts([0n, 1n, 0n, 1n]))
    expect(stringifyBigInts(initialStacks[3])).to.eq(stringifyBigInts([1n, 1n, 0n, 1n]))
    
    expect(stringifyBigInts(initialStacks[4])).to.eq(stringifyBigInts([2n, 0n, 0n, 2n]))
    expect(stringifyBigInts(initialStacks[5])).to.eq(stringifyBigInts([3n, 0n, 0n, 2n]))
    expect(stringifyBigInts(initialStacks[6])).to.eq(stringifyBigInts([2n, 1n, 0n, 2n]))
    expect(stringifyBigInts(initialStacks[7])).to.eq(stringifyBigInts([3n, 1n, 0n, 2n]))
    
    expect(stringifyBigInts(initialStacks[8])).to.eq(stringifyBigInts([4n, 0n, 0n, 3n]))
    expect(stringifyBigInts(initialStacks[9])).to.eq(stringifyBigInts([5n, 0n, 0n, 3n]))
    expect(stringifyBigInts(initialStacks[10])).to.eq(stringifyBigInts([4n, 1n, 0n, 3n]))
    expect(stringifyBigInts(initialStacks[11])).to.eq(stringifyBigInts([5n, 1n, 0n, 3n]))

    expect(stringifyBigInts(initialStacks[12])).to.eq(stringifyBigInts([0n, 2n, 0n, 4n]))
    expect(stringifyBigInts(initialStacks[13])).to.eq(stringifyBigInts([1n, 2n, 0n, 4n]))
    expect(stringifyBigInts(initialStacks[14])).to.eq(stringifyBigInts([0n, 3n, 0n, 4n]))
    expect(stringifyBigInts(initialStacks[15])).to.eq(stringifyBigInts([1n, 3n, 0n, 4n]))

    // lets fetch points
    // function calculateGamePoints(uint256 sessionId, uint8 game) public view returns (uint256, uint256) {
    const points = await player1Contract.calculateGamePoints(1, 0)
    
    // slight difference from web since they are not highest and lowest at the same time for efficiency, 16 and 16 vs 24 and 24
    expect(points[0]).to.eq(16n)
    expect(points[1]).to.eq(16n)
  })

  // round 2
  it("playing2", async () => {
    // 0 is rotation towards x, 1 is rotation towards z, 2 is rotation towards y
    // players will just play the bottom 3 rows
    // player 1 starts and player 2 just follows him and repeat that 6 times
    for(let i = 0; i < 6; i++) {
      const session = await player1Contract.gameSessions(1)
      expect(session[4]).to.eq(0n) // game is 0
      const legitMoveTx1 = await player1Contract.play(1, 0, 0, 0)
      await legitMoveTx1.wait()
      const legitMoveTx2 = await player2Contract.play(1, 0, 0, 0)
      await legitMoveTx2.wait()

      const legitMoveTx3 = await player1Contract.play(1, 2, 0, 0)
      await legitMoveTx3.wait()
      const legitMoveTx4 = await player2Contract.play(1, 2, 0, 0)
      await legitMoveTx4.wait()
    }

    // now game should be in phase 2
    const session = await player1Contract.gameSessions(1)
    expect(session[4]).to.eq(1n) // game is 1
    // lets fetch points
    const points = await player1Contract.calculateGamePoints(1, 0)
    expect(points[0]).to.eq(12n)
    expect(points[1]).to.eq(20n)
  })

  // round 3
  it("playing3", async () => {
    const session = await player1Contract.gameSessions(1)
    expect(session[4]).to.eq(1n) // game is 1
    // also turn should be 1
    expect(session[3]).to.eq(1n) // turn is 1

    // player 2 should be starting
    const legitMoveTx1 = await player2Contract.play(1, 0, 0, 0)
    await legitMoveTx1.wait()
    const legitMoveTx2 = await player1Contract.play(1, 2, 0, 0)
    await legitMoveTx2.wait()
    const legitMoveTx3 = await player2Contract.play(1, 4, 0, 0)
    await legitMoveTx3.wait()
    const legitMoveTx4 = await player1Contract.play(1, 0, 2, 0)
    await legitMoveTx4.wait()

    // they make new wagers
    await player2Contract.proposeWager(1, ethers.parseEther("3"), { value: ethers.parseEther("3") })
    await player1Contract.acceptWagerProposal(1, ethers.parseEther("3"), { value: ethers.parseEther("3") })
    // now lets check balance on contract should be 10 eth
    const contractBalance = await provider.getBalance(contractAddress)
    expect(contractBalance).to.eq(ethers.parseEther("10"))

    // now game should be in round 4
    for(let i = 0; i < 6; i++) {
      const legitMoveTx1 = await player2Contract.play(1, 0, 0, 0)
      await legitMoveTx1.wait()
      const legitMoveTx2 = await player1Contract.play(1, 0, 0, 0)
      await legitMoveTx2.wait()

      const legitMoveTx3 = await player2Contract.play(1, 2, 0, 0)
      await legitMoveTx3.wait()
      const legitMoveTx4 = await player1Contract.play(1, 2, 0, 0)
      await legitMoveTx4.wait()
    }
    //lets check what the current turn is
    const session2 = await player1Contract.gameSessions(1)
    expect(session2[3]).to.eq(29n) // turn is 0
    // wager should be 5 eth
    expect(session2[2][0].toString()).to.eq(ethers.parseEther("5").toString()) //wager is 5 total balance is 10
    

    // lets calculate points game 0
    const points = await player1Contract.calculateGamePoints(1, 0)
    expect(points[0]).to.eq(12n)
    expect(points[1]).to.eq(20n)

    // points for game 1 IMPORTANT 0 IS NOT PLAYER 1 BUT STARTER OF THE GAME
    const points2 = await player1Contract.calculateGamePoints(1, 0)
    expect(points2[0]).to.eq(12n)
    expect(points2[1]).to.eq(20n)

    // in total both players have 24 points

    // lets check contract balance before accepting rewards
    const contractBalanceBefore = await provider.getBalance(contractAddress)
    expect(contractBalanceBefore).to.eq(ethers.parseEther("10"))

    // function acceptRewards(uint256 sessionId) external {
    const acceptRewardsTx = await player1Contract.acceptRewards(1)
    await acceptRewardsTx.wait()
    // it is a tie but doesn't matter we can check this on web
    // now balance on contract should be 0 eth
    const contractBalanceAfter = await provider.getBalance(contractAddress)
    expect(contractBalanceAfter).to.eq(0n)
    

    // if player tries to move again, it should be rejected
    await expectRejectedWithMessage(player2Contract.play(1, 0, 0, 0), "GameSession has ended")

    // lets try to set time limit to 1 second
    await adminContract.setGameTimeLimit(1n)
    await adminContract.setExtraTimeForPlayer1(0n)
    // if a player wants to make a new game, he should be able to, since the previous game has ended
    await player2Contract.createSession(richWalletsAddresses[1], richWalletsAddresses[2])
    // a new game can't be created since the time limit is 1 second
    await expectRejectedWithMessage(player2Contract.createSession(richWalletsAddresses[1], richWalletsAddresses[2]), "Player 1 has an active session")

    // ok if we sleep for 2 seconds, the game should be ended and a new game can be created
    await new Promise(resolve => setTimeout(resolve, 1200)) // player 1
    // lets reset time limit to 10 minutes
    await adminContract.setExtraTimeForPlayer1(0n)
    await adminContract.setGameTimeLimit(600n)
    const createSessionTx = await player2Contract.createSession(richWalletsAddresses[1], richWalletsAddresses[2])
    await createSessionTx.wait()

    // you can only forfeit an active session
    await expectRejectedWithMessage(player2Contract.forfeit(1), "Not an active session")
    const forfeitTx = await player2Contract.forfeit(await player2Contract.getPlayerActiveSession(richWalletsAddresses[2]))
    await forfeitTx.wait()
    // lets check if the game is forfeited
    const session3 = await player1Contract.gameSessions(3)  
    expect(session3[10]).to.eq(richWalletsAddresses[2]) // forfeitedBy is player 2

    await new Promise(resolve => setTimeout(resolve, 1000)) // player 1 has 5 additional seconds to move
    await player2Contract.createSession(richWalletsAddresses[1], richWalletsAddresses[2])
    // lets set back time limit to 10 minutes
    // end the game
    const forfeitTx2 = await player2Contract.forfeit(4)
    await forfeitTx2.wait()
  })


// Define types for structured data
interface BlockPlacedEvent {
  turn: number;
  pieceType: number;
  x: number;
  z: number;
  rotation: number;
}


// Define the 3D grid type
type Grid = Number[][][];

async function reconstructGrid(sessionId: number, game: number): Promise<Grid> {
  // Create an empty 8x8 grid where each cell is an array (stacks of blocks)
  let grid: Grid = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => [])
  );
  try {
      // Fetch past logs of the BlockPlaced event
      // I dont think this filter works!
      // I dont think this filter works!
      // I dont think this filter works!
      // I dont think this filter works!
      const eventFilter = adminContract.filters.BlockPlaced(
        BigInt(sessionId), 
        game
      );
      
      // console.log("Fetching logs with filter:", eventFilter);
      
      const logs = await provider.getLogs({
          ...eventFilter,
          fromBlock: 0,
          toBlock: "latest"
      });
      
      // console.log("Found logs:", logs.length);
      
      // Parse logs and populate grid
      for (const log of logs) {
          try {
              const parsedLog = adminContract.interface.parseLog({
                  data: log.data,
                  topics: log.topics
              });
              
              if (!parsedLog) {
                  console.log("Failed to parse log:", log);
                  continue;
              }
              
              //console.log("Parsed log args:", parsedLog.args);
              
              // Use the specific names from your event definition
              // event BlockPlaced(uint256 indexed sessionId, uint8 indexed game, uint8 turn, uint8 pieceType, uint8 x, uint8 z, uint8 y, Rotation rotation);
              const turn = Number(parsedLog.args[2]); // turn
              const pieceType = Number(parsedLog.args[3]); // pieceType
              const x = Number(parsedLog.args[4]); // x
              const z = Number(parsedLog.args[5]); // z
              const rotation = Number(parsedLog.args[7]); // rotation
              const color = ((turn - 1) % 4) + 1;
              
              //console.log(`Processing block: x=${x}, z=${z}, y=${y}, pieceType=${pieceType}, color=${color}, rotation=${rotation}`);
              
              if (pieceType === 1) { // 4x1 block
                  const y = 0
                  grid[x][z][y] = color;
                  grid[x+1][z][y] = color;
                  grid[x][z+1][y] = color;
                  grid[x+1][z+1][y] = color;
              } else { // 2x1 block
                // y is highest in that x z range
                  const y = 123
                  grid[x][z][y] = color;
                  if (rotation === 0) {
                      grid[x+1][z][y] = color;
                  } else if (rotation === 1) {
                      grid[x][z+1][y] = color;
                  } else {
                      grid[x][z][y+1] = color;
                  }
              }
          } catch (error) {
              // console.error("Error processing log:", error);
              // console.log("Problematic log:", log);
          }
      }
      return grid;
  } catch (error) {
      console.error("Error fetching logs:", error);
      return grid;
  }
}
// reconstruct grid from events
it("reconstructing grid", async () => {
  const grid = await reconstructGrid(1, 0)
  // this is 8x8 and they must match the grid
  const stacksGrid = await player1Contract.getStacksGrid(1,0) // session 1, game 0 8x8 = y and color
  //console.log(grid)
  //console.log(stacksGrid)
  for(let z = 0; z < 8; z++) {
    for(let x = 0; x < 8; x++) {
      //console.log(grid[x][z][stacksGrid[x][z][2]] ?? 0, Number(stacksGrid[x][z][3] ?? 0))
      expect(grid[x][z][stacksGrid[x][z][2]] ?? 0).to.eq(Number(stacksGrid[x][z][3] ?? 0))
    }
  }
})

// lets start another game, and see if blocks fall down correctly
it("blocks fall down correctly", async () => {
  // lets check if no active session is left
  let stacksGrid
  expect(await player1Contract.getPlayerActiveSession(richWalletsAddresses[1])).to.eq(0n)
  expect(await player1Contract.getPlayerActiveSession(richWalletsAddresses[2])).to.eq(0n)
  // lets start another game
  await player2Contract.createSession(richWalletsAddresses[1], richWalletsAddresses[2])
  // lets make the default grid
  const sessionId = 4
  const legitMoveTx1 = await player1Contract.play(sessionId, 0, 0, 0)
  await legitMoveTx1.wait()
  const legitMoveTx2 = await player2Contract.play(sessionId, 2, 0, 0)
  await legitMoveTx2.wait()
  const legitMoveTx3 = await player1Contract.play(sessionId, 4, 0, 0)
  await legitMoveTx3.wait()
  const legitMoveTx4 = await player2Contract.play(sessionId, 0, 2, 0)
  await legitMoveTx4.wait()
  stacksGrid = await player1Contract.getStacksGrid(sessionId, 0)

  // lets place a block on top of the grid
  const legitMoveTx5 = await player1Contract.play(sessionId, 0, 0, 0)
  await legitMoveTx5.wait()
  stacksGrid = await player1Contract.getStacksGrid(sessionId, 0)
  expect(stacksGrid[0][0][2]).to.eq(1n)
  expect(stacksGrid[1][0][2]).to.eq(1n)
  expect(stacksGrid[2][0][2]).to.eq(0n)
  // lets place another block
  const legitMoveTx6 = await player2Contract.play(sessionId, 1, 0, 0)
  await legitMoveTx6.wait()
  stacksGrid = await player1Contract.getStacksGrid(sessionId, 0)
  expect(stacksGrid[0][0][2]).to.eq(1n)
  expect(stacksGrid[1][0][2]).to.eq(2n)
  expect(stacksGrid[2][0][2]).to.eq(1n)

  const legitMoveTx7 = await player1Contract.play(sessionId, 0, 0, 0)
  await legitMoveTx7.wait()
  stacksGrid = await player1Contract.getStacksGrid(sessionId, 0)
  expect(stacksGrid[0][0][2]).to.eq(2n)
  expect(stacksGrid[1][0][2]).to.eq(3n)
  expect(stacksGrid[2][0][2]).to.eq(1n)
})

// lets make a function that converts stacks grid to 2d grid with height
// 1 1 1 1 1 1 1 1
// 1 1 1 1 1 1 1 1
// 1 1 1 1 1 1 1 1
// 1 1 1 1 1 1 1 1
// 1 1 1 1 1 1 1 1
// 1 1 1 1 1 1 1 1
// 1 1 1 1 1 1 1 1
function logStacksGridTo2DGrid(stacksGrid: number[][][]) {
  for(let z = 0; z < 8; z++) {
    console.log(stacksGrid[0][z][2], stacksGrid[1][z][2], stacksGrid[2][z][2], stacksGrid[3][z][2], stacksGrid[4][z][2], stacksGrid[5][z][2], stacksGrid[6][z][2], stacksGrid[7][z][2])
  }
}


  // it("test", async () => {
  //   function createSession(address player1, address player2, uint8 x, uint8 z) external {
  // })

  // it("withdrawal works", async function () {
  //   const balanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
  //   // get balance on contract
  //   const contractBalanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(contractAddress)))

  //   const tx = await adminContract.withdraw()
  //   await tx.wait()
  //   const balanceAfter = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
  //   // balance on contractAfter
  //   const contractBalanceAfter = parseFloat(ethers.formatEther(await provider.getBalance(contractAddress)))
  //   expect(contractBalanceAfter).to.be.lt(contractBalanceBefore)
  //   expect(balanceAfter).to.be.gt(balanceBefore)

  //   // we have to test erc20 withdrawal withdrawERC20(address erc20Token)
  //   // lets check balance of erc20 ERC20Contract
  //   const erc20UserBalanceBefore = await ERC20Contract.balanceOf(withdrawAddress)
  //   const erc20ContractBalanceBefore = await ERC20Contract.balanceOf(contractAddress)
  //   const tx2 = await adminContract.withdrawERC20(await ERC20Contract.getAddress())
  //   await tx2.wait()
  //   const erc20UserBalanceAfter = await ERC20Contract.balanceOf(withdrawAddress)
  //   await ERC20Contract.balanceOf(contractAddress)
  //   expect(erc20UserBalanceAfter).to.be.eq(
  //     erc20UserBalanceBefore
  //     // comission is 5%
  //     + (erc20ContractBalanceBefore) * BigInt(95) / BigInt(100),
  //   )
  //   // expect(erc20ContractBalanceAfter).to.be.lt(erc20ContractBalanceBefore)
  // })
})
