import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";
import { createMintSignature } from "../testUtils";
import fs from "fs";
import path from "path";
import { getRichWallets } from "../../utils/utils";

const TOTAL = 666n;
const MINT_PRICE = ethers.parseEther("0.01");

const provider = new ethers.BrowserProvider(hre.network.provider as any);

// Helper function to advance time and ensure blockchain state is updated
async function advanceTime(seconds: number, signer: any) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function setBlockchainTime(timestamp: number) {
  await provider.send("evm_setNextBlockTimestamp", [timestamp])
  await provider.send("evm_mine", []) // mine a block so time is applied
}

// Helper function to log current on-chain time using TestUtils contract
async function logTime(label: string, testUtils: any) {
  // Force multiple blocks to be mined to ensure we get the actual latest timestamp
  const timestamp = Number(await testUtils.getCurrentTime());
  const blockNumber = await provider.getBlockNumber();
  const date = new Date(timestamp * 1000);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[date.getUTCDay()];
  const dateStr = date.toISOString().split('T')[0]; // Gets YYYY-MM-DD
  const time = date.toUTCString().split(' ')[4]; // Gets HH:MM:SS
  
  console.log(`${label}: ${dayName} ${dateStr} ${time} UTC (${timestamp}) [Block ${blockNumber}]`);
  return dayName;
}

// Helper function to update both Pyth and AMM prices
async function updatePrices(newPrice: bigint, mockPyth: any, mockPool: any) {
  await mockPyth.updatePrice(newPrice, -8);
  await mockPool.setPrice(newPrice);
  console.log(`Updated both prices to: ${newPrice} ($${(Number(newPrice) / 1e8).toFixed(2)})`);
}

describe("ProphetsOfEthereum - Signature Minting Tests", () => {
  let prophets: any;
  let mockPyth: any;
  let mockPool: any;
  let testUtils: any;
  let deployer: any, user1: any, user2: any, approver: any;

  let currentEthPrice = 0n

  const currentSundayTimestamp = 1757253600 // 2025-09-07 15:00 CET
  let currentIteration = 0
  beforeEach(async () => {
    console.log(`currentIteration: ${currentIteration}`);
    const targetTimestamp = currentSundayTimestamp + (currentIteration * 24 * 60 * 60 * 7 * 10)
    //await setBlockchainTime(targetTimestamp)
    console.log(`SetBlockchainTimeToSetBlockchainTimeToSetBlockchainTimeToSetBlockchainTimeTo: ${targetTimestamp}`);
    currentIteration++
    // deployer = await provider.getSigner(0);
    //user1 = await provider.getSigner(1);
    //user2 = await provider.getSigner(2);
    //approver = await provider.getSigner(3);
    const wallets = await getRichWallets();
    deployer = wallets[0];
    user1 = wallets[1];
    user2 = wallets[2];
    approver = wallets[3];

    // Deploy TestUtils
    const testUtilsArtifact = await hre.artifacts.readArtifact("TestUtils");
    const TestUtils = new ethers.ContractFactory(testUtilsArtifact.abi, testUtilsArtifact.bytecode, deployer);
    testUtils = await TestUtils.deploy();
    await testUtils.waitForDeployment();
    console.log(`TestUtils deployed at: ${await testUtils.getAddress()}`);

    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    currentEthPrice = 4000n * 10n ** 8n; // $4000
    mockPyth = await MockPyth.deploy(currentEthPrice, -8);
    await mockPyth.waitForDeployment();

    // Deploy mock tokens first
    const mockERC20Artifact = await hre.artifacts.readArtifact("MockERC20");
    const MockERC20 = new ethers.ContractFactory(mockERC20Artifact.abi, mockERC20Artifact.bytecode, deployer);
    const mockWETH = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    const mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockWETH.waitForDeployment();
    await mockUSDC.waitForDeployment();
    
    // Deploy MockUniswapPool
    const mockPoolArtifact = await hre.artifacts.readArtifact("MockUniswapPool");
    const MockPool = new ethers.ContractFactory(mockPoolArtifact.abi, mockPoolArtifact.bytecode, deployer);
    mockPool = await MockPool.deploy();
    await mockPool.waitForDeployment();
    
    // Set proper token addresses
    await mockPool.setTokens(await mockWETH.getAddress(), await mockUSDC.getAddress());
    
    // Set mock pool price to match currentEthPrice
    await mockPool.setPrice(currentEthPrice);

    // Deploy ProphetsRenderer first
    const rendererArtifact = await hre.artifacts.readArtifact("ProphetsRenderer");
    const Renderer = new ethers.ContractFactory(rendererArtifact.abi, rendererArtifact.bytecode, deployer);
    const renderer = await Renderer.deploy() as any;
    await renderer.waitForDeployment();

    // Deploy all 4 images
    const images = [
      { state: "prophesizing", file: "01prophesizing.txt" },
      { state: "bearish", file: "02bearish.txt" },
      { state: "bullish", file: "03bullish.txt" },
      { state: "burned", file: "04burned.txt" }
    ];

    for (const img of images) {
      const imagePath = path.join(__dirname, "../../deploy/images", img.file);
      const imageData = fs.readFileSync(imagePath, "utf8").trim();
      await renderer.storeImage(img.state, imageData);
    }

    // Deploy Prophets with correct constructor parameters
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const mockMarketplace = ethers.ZeroAddress;
    const defaultOperator = await deployer.getAddress();

    // log the prophets address
    
    prophets = await Prophets.deploy(
      await renderer.getAddress(),  // _renderer
      await mockPool.getAddress(),  // uniPool (now using mock pool)
      await approver.getAddress(), // _approver
      mockMarketplace,             // _marketplace
      await mockPyth.getAddress()  // _pythContract
    );
    await prophets.waitForDeployment();
    console.log(`prophets address: ${await prophets.getAddress()}`);

    // Configure to use PYTH mode
    await prophets.setPriceProvider(1); // PYTH_OR_AMM = 2, PYTH = 1, AMM = 0

    console.log(`currentEthPrice: ${currentEthPrice}`);
    // test price
    const price = await prophets.readPythPrice();
    console.log(`price: ${price}`);
    expect(price).to.equal(currentEthPrice);
    const price2 = await prophets.readAMMPrice();
    console.log(`price2: ${price2}`);
    expect(price2).to.equal(currentEthPrice);
    const price3 = await prophets.readCurrentPrice();
    console.log(`price3: ${price3}`);
    expect(price3).to.equal(currentEthPrice);

    const contractAddress = await prophets.getAddress();
    let currentTime = Math.floor(Date.now() / 1000);
    const endTime = currentTime + (365 * 24 * 60 * 60);
    const pricePerToken = MINT_PRICE;

    // Create signatures for both wallets
    const signature1 = await createMintSignature(
      approver,
      prophets,
      await user1.getAddress(),
      1, // saleId
      endTime,
      333, // maxMint
      pricePerToken
    );

    const signature2 = await createMintSignature(
      approver,
      prophets,
      await user2.getAddress(),
      2, // saleId
      endTime,
      333, // maxMint
      pricePerToken
    );

    // Mint 333 tokens to user1
    await prophets.connect(user1).mint(
      1, // saleId
      endTime,
      333, // maxMint
      pricePerToken,
      333, // amount
      signature1,
      { value: pricePerToken * 333n }
    );

    // Mint 333 tokens to user2 to complete mint-out
     const tx = await prophets.connect(user2).mint(
      2, // saleId
      endTime,
      333, // maxMint
      pricePerToken,
      333, // amount
      signature2,
      { value: pricePerToken * 333n }
    );
    await tx.wait();
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");

    expect(await prophets.totalSupply()).to.equal(TOTAL);
    expect(await prophets.firstCycleStart()).to.be.gt(0);
    expect(await prophets.mintCompleteTimestamp()).to.be.gt(0);
    
    // Check balances
    expect(await prophets.balanceOf(await user1.getAddress())).to.equal(333);
    expect(await prophets.balanceOf(await user2.getAddress())).to.equal(333);

    // Wait for Sunday window
    const firstCycleStart = await prophets.firstCycleStart();
    let currentBlock = await provider.getBlock("latest");
    const currentTime2 = currentBlock!.timestamp;
    const timeToSunday = Number(firstCycleStart) + 60 - currentTime2;
    
    console.log(`firstCycleStart: ${firstCycleStart} (${new Date(Number(firstCycleStart) * 1000).toUTCString()})`);
    console.log(`currentTime2: ${currentTime2} (${new Date(currentTime2 * 1000).toUTCString()})`);
    console.log(`timeToSunday: ${timeToSunday} seconds`);
    
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");

    if(timeToSunday > 0) {
      await advanceTime(timeToSunday, deployer);
    }


    // After time advancement, should be Sunday (cycle 1)
    const currentCycleAfter = await prophets.getCurrentCycle();
    expect(currentCycleAfter).to.equal(1); // Now in Sunday window (cycle 1)
    
    // Log what day we're actually on after advancing to "Sunday"
    await logTime("After advancing to Sunday window", testUtils);

    const prediction1 = Number(currentEthPrice) * 0.95; // -5% (will be lowest)
    const prediction2 = Number(currentEthPrice) * 1.05; // +5% (will be highest)

    await expect(prophets.connect(user1).makePrediction(1, currentEthPrice)).to.be.revertedWith("Prediction must differ by at least 1% from cycle start price");

    await prophets.connect(user1).makePrediction(1, Math.floor(prediction1));
    await prophets.connect(user1).makePrediction(3, Math.floor(prediction1));
    await prophets.connect(user2).makePrediction(334, Math.floor(prediction2));
    // expect throw not owner
    await expect(prophets.connect(user2).makePrediction(2, Math.floor(prediction1))).to.be.revertedWith("Caller is not the owner of this token");

    expect(await prophets.predictions(1, 1)).to.equal(prediction1);

    // lets make sure the user cannot change their prediction
    await expect(prophets.connect(user1).makePrediction(1, Math.floor(prediction2))).to.be.revertedWith("Cannot change prediction: you hold the lowest position");
    await expect(prophets.connect(user2).makePrediction(334, Math.floor(prediction1))).to.be.revertedWith("Cannot change prediction: you hold the highest position");
    
    // We're currently on Sunday (just made predictions), advance 1 day to Monday
    await advanceTime(24 * 60 * 60, deployer); // 24 hours to be clearly on Monday
    
    const dayAfter = await logTime("AFTER advancement to monday (first burning)", testUtils);
    console.log(`Current cycle: ${await prophets.getCurrentCycle()}`);
    
    // Verify we're now on Monday
    expect(dayAfter).to.equal("Monday");
    
    // 2 and 335 should be burned
    expect(await prophets.isBurned(2)).to.be.true;
    expect(await prophets.isBurned(335)).to.be.true;
    // now the user should not be able to change their prediction
    await expect(prophets.connect(user1).makePrediction(2, Math.floor(prediction2))).to.be.revertedWith("This prophet has been burned and cannot make predictions");
    await expect(prophets.connect(user2).makePrediction(335, Math.floor(prediction1))).to.be.revertedWith("This prophet has been burned and cannot make predictions");
    // lets log time again on contract side
    await logTime("After burning", testUtils);
    await expect(prophets.connect(user1).makePrediction(3, Math.floor(prediction2))).to.be.revertedWith("Predictions can only be made during Sunday window (00:00-23:59 UTC)");

    // lets try to claim the divine blessing
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
    
    // lets advance next sunday // no need to change price, 3 nfts should SURVIVE
    await advanceTime(24 * 60 * 60 * 6, deployer);
    // lets log the cycle
    console.log(`Current cycle: ${await prophets.getCurrentCycle()}`);
    await logTime("After advancing to next sunday", testUtils);
    // expect sunday on contract
    console.log(`logging3: ${await prophets.getCurrentCycle()}`);
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
    console.log(`logging4: ${await prophets.getCurrentCycle()}`);
    // lets try to claim the divine blessing with the wrong cycle

    // ALIVE CHECK, LETS CHECK THE 3 ALIVE ONES
    // Check that tokens 1, 3, and 334 are alive (not burned)
    expect(await prophets.isBurned(1)).to.be.false;
    expect(await prophets.isBurned(3)).to.be.false;
    expect(await prophets.isBurned(334)).to.be.false;
  });

  describe("Signature-based Minting", () => {
    it("testing iteration 2", async () => {
      const winnerPrediction = Math.floor(Number(currentEthPrice) * 1.05);
      const loserPrediction1 = Math.floor(Number(currentEthPrice) * 0.899);
      const loserPrediction2 = Math.floor(Number(currentEthPrice) * 1.101);

      // NEW PHASE, 2 WILL BE WRONG, AND BURNED
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      await prophets.connect(user1).makePrediction(3, loserPrediction1);
      await prophets.connect(user2).makePrediction(334, loserPrediction2);

      await advanceTime(24 * 60 * 60 * 7, deployer);
      await logTime("After advancing to next sunday", testUtils);
      await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      await expect(prophets.connect(user2).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      expect(await prophets.isBurned(1)).to.be.false;
      expect(await prophets.isBurned(3)).to.be.true;
      expect(await prophets.isBurned(334)).to.be.true;

      // ok make his final prediction
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      // fast forward to monday
      await advanceTime(24 * 60 * 60 * 2, deployer);
      await logTime("After advancing to tuesday", testUtils);
      await expect(prophets.connect(user1).acceptDivineBlessing(3))
      // get winner
      const winner = await prophets.getWinner(3);
      expect(winner).to.equal(1);
    });
  });
});


// we can test these cases:

// winner wins by predicting correctly bullish, 5% more than current price, unless he forgets to make prediction on sunday, which is stupid.
// winner wins by predicting correctly bearish, 5% less than current price
// winner wins by predicting correctly bullish, but 5% less than current price
// winner wins by predicting correctly bearish, but 5% more than current price
// 5: All burn, price changes barely to bearish, but winner wins because of lowest prediction
// 5: All burn, price changes barely to bullish, but winner wins because of highest prediction

// all get burned, everyone burns themselves via listing

// Price goes from 1000 to 1100


// WHOOOPS FORGOT TO CLAIM DIVINE TREASURY WHEN I WON, you lose
// there is an edge case where winner needs to do another prophesy, it can be whatever, but he just needs to do it in order to prove he is the only one alive on monday. If he does not, someone else could win