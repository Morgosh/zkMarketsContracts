import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";
import { createMintSignature } from "../testUtils";
import fs from "fs";
import path from "path";

const TOTAL = 666n;
const MINT_PRICE = ethers.parseEther("0.01");

const provider = new ethers.BrowserProvider(hre.network.provider as any);

// Helper function to advance time and ensure blockchain state is updated
async function advanceTime(seconds: number, signer: any) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

// Helper function to log current on-chain time using contract's view
async function logTime(label: string, prophetsContract: any) {
  // Force multiple blocks to be mined to ensure we get the actual latest timestamp
  const timestamp = Number(await prophetsContract.getCurrentTime());
  const blockNumber = await provider.getBlockNumber();
  const date = new Date(timestamp * 1000);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[date.getUTCDay()];
  const time = date.toUTCString().split(' ')[4]; // Gets HH:MM:SS
  
  console.log(`${label}: ${dayName} ${time} UTC (${timestamp}) [Block ${blockNumber}]`);
  return dayName;
}

describe("ProphetsOfEthereum - Signature Minting Tests", () => {
  let prophets: any;
  let mockPyth: any;
  let deployer: any, user1: any, user2: any, approver: any;

  let currentEthPrice = 0n
  beforeEach(async () => {
    deployer = await provider.getSigner(0);
    user1 = await provider.getSigner(1);
    user2 = await provider.getSigner(2);
    approver = await provider.getSigner(3);

    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    currentEthPrice = 4000n * 10n ** 8n; // $4000
    mockPyth = await MockPyth.deploy(currentEthPrice, -8);
    await mockPyth.waitForDeployment();

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
    const dummyPool = ethers.ZeroAddress;
    const mockMarketplace = ethers.ZeroAddress;
    const defaultOperator = await deployer.getAddress();
    
    prophets = await Prophets.deploy(
      await renderer.getAddress(),  // _renderer
      dummyPool,                   // uniPool
      await approver.getAddress(), // _approver
      mockMarketplace,             // _marketplace
      await mockPyth.getAddress()  // _pythContract
    );
    await prophets.waitForDeployment();

    // Configure to use PYTH mode
    await prophets.setPriceProvider(1); // PYTH = 1
  });

  describe("Signature-based Minting", () => {
    it("testing iteration 1", async () => {
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
      await prophets.connect(user2).mint(
        2, // saleId
        endTime,
        333, // maxMint
        pricePerToken,
        333, // amount
        signature2,
        { value: pricePerToken * 333n }
      );

      expect(await prophets.totalSupply()).to.equal(TOTAL);
      expect(await prophets.firstCycleStart()).to.be.gt(0);
      expect(await prophets.mintCompleteTimestamp()).to.be.gt(0);
      
      // Check balances
      expect(await prophets.balanceOf(await user1.getAddress())).to.equal(333);
      expect(await prophets.balanceOf(await user2.getAddress())).to.equal(333);

      // Before first cycle starts, should NOT be Sunday (cycle 0)
      const currentCycleBefore = await prophets.getCurrentCycle();
      expect(currentCycleBefore).to.equal(0); // Not in Sunday window yet

      // Wait for Sunday window
      const firstCycleStart = await prophets.firstCycleStart();
      let currentBlock = await provider.getBlock("latest");
      const currentTime2 = currentBlock!.timestamp;
      const timeToSunday = Number(firstCycleStart) + 60 - currentTime2;
      
      console.log(`firstCycleStart: ${firstCycleStart} (${new Date(Number(firstCycleStart) * 1000).toUTCString()})`);
      console.log(`currentTime2: ${currentTime2} (${new Date(currentTime2 * 1000).toUTCString()})`);
      console.log(`timeToSunday: ${timeToSunday} seconds`);
      
      await advanceTime(timeToSunday, deployer);

      // After time advancement, should be Sunday (cycle 1)
      const currentCycleAfter = await prophets.getCurrentCycle();
      expect(currentCycleAfter).to.equal(1); // Now in Sunday window (cycle 1)
      
      // Log what day we're actually on after advancing to "Sunday"
      await logTime("After advancing to Sunday window", prophets);

      const prediction1 = Number(currentEthPrice) * 0.95; // -5% (will be lowest)
      const prediction2 = Number(currentEthPrice) * 1.05; // +5% (will be highest)

      await prophets.connect(user1).makePrediction(1, Math.floor(prediction1));
      await prophets.connect(user1).makePrediction(3, Math.floor(prediction1));
      await prophets.connect(user2).makePrediction(334, Math.floor(prediction2));
      // expect throw not owner
      await expect(prophets.connect(user2).makePrediction(2, Math.floor(prediction1))).to.be.revertedWith("Caller is not the owner of this token");

      expect(await prophets.predictions(1, 1)).to.equal(prediction1);

      // lets make sure the user cannot change their prediction
      await expect(prophets.connect(user1).makePrediction(1, Math.floor(prediction2))).to.be.revertedWith("Cannot change prediction: you hold the lowest position");
      await expect(prophets.connect(user2).makePrediction(334, Math.floor(prediction1))).to.be.revertedWith("Cannot change prediction: you hold the highest position");

      
      // Log time before and after advancement
      await logTime("BEFORE advancement", prophets);
      
      // We're currently on Sunday (just made predictions), advance 1 day to Monday
      await advanceTime(24 * 60 * 60, deployer); // 24 hours to be clearly on Monday
      
      const dayAfter = await logTime("AFTER advancement", prophets);
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
      await logTime("After burning", prophets);
      await expect(prophets.connect(user1).makePrediction(3, Math.floor(prediction2))).to.be.revertedWith("Predictions can only be made during Sunday window (00:00-23:59 UTC)");
    });
  });
});
