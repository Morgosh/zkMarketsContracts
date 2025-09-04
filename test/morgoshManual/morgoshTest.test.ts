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

describe("ProphetsOfEthereum - Signature Minting Tests", () => {
  let prophets: any;
  let mockPyth: any;
  let testUtils: any;
  let deployer: any, user1: any, user2: any, approver: any;

  let currentEthPrice = 0n
  beforeEach(async () => {
    deployer = await provider.getSigner(0);
    user1 = await provider.getSigner(1);
    user2 = await provider.getSigner(2);
    approver = await provider.getSigner(3);

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
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");

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
    
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
    await advanceTime(timeToSunday, deployer);

    // After time advancement, should be Sunday (cycle 1)
    const currentCycleAfter = await prophets.getCurrentCycle();
    expect(currentCycleAfter).to.equal(1); // Now in Sunday window (cycle 1)
    
    // Log what day we're actually on after advancing to "Sunday"
    await logTime("After advancing to Sunday window", testUtils);

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
    await logTime("BEFORE advancement", testUtils);
    
    // We're currently on Sunday (just made predictions), advance 1 day to Monday
    await advanceTime(24 * 60 * 60, deployer); // 24 hours to be clearly on Monday
    
    const dayAfter = await logTime("AFTER advancement", testUtils);
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
    await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
    // lets try to claim the divine blessing with the wrong cycle

    // ALIVE CHECK, LETS CHECK THE 3 ALIVE ONES
    // Check that tokens 1, 3, and 334 are alive (not burned)
    expect(await prophets.isBurned(1)).to.be.false;
    expect(await prophets.isBurned(3)).to.be.false;
    expect(await prophets.isBurned(334)).to.be.false;
  });

  describe("Signature-based Minting", () => {
    it("testing iteration 1", async () => {
      const winnerPrediction = Math.floor(Number(currentEthPrice) * 0.95);
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
      await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");

      // make valid prediction on sunday
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      // loop to monday
      await advanceTime(24 * 60 * 60 * 1, deployer);
      await logTime("After advancing to monday", testUtils);
      // expect(await prophets.isBurned(1)).to.be.true; // he didn't vote retard
      expect(await prophets.isBurned(1)).to.be.false; // he didn't vote retard
      // lets log cycle 
      console.log(`Current cycle: ${await prophets.getCurrentCycle()}`);

      // CLAIM DIVINE TREASURY
      // get user balance before
      const user1BalanceBefore = await provider.getBalance(await user1.getAddress());
      console.log(`user1BalanceBefore: ${user1BalanceBefore}`);
      const treasuryBefore = await prophets.getTreasury();
      // treasury should be higher
      expect(treasuryBefore).to.be.gt(0);
      console.log(`treasuryBefore: ${treasuryBefore}`);
      // contract balance
      const contractBalanceBefore = await provider.getBalance(await prophets.getAddress());
      console.log(`contractBalanceBefore: ${contractBalanceBefore}`);
      // getWinner should return 1
      expect(await prophets.getWinner(3)).to.equal(1);
      const acceptTx = await prophets.connect(user1).acceptDivineBlessing(3);
      await acceptTx.wait();
      // mine block
      await provider.send("evm_mine", []);
      // log user balance after
      const user1BalanceAfter1 = await provider.getBalance(await user1.getAddress());
      console.log(`user1BalanceAfterDivineBlessing: ${user1BalanceAfter1}`);
      // contract balance after
      const contractBalanceAfter1 = await provider.getBalance(await prophets.getAddress());
      console.log(`contractBalanceAfterDivineBlessing: ${contractBalanceAfter1}`);

      expect(await testUtils.getAddressBalance(await user1.getAddress())).to.be.gt(0);
      expect(await prophets.blessedByDivine()).to.equal(1);
      expect(await prophets.blessedAtCycle()).to.equal(3);
      expect(await prophets.getTreasury()).to.be.equal(0);
      // balance on contract should be 1 ether - use contract's own balance checker
      expect(await testUtils.getContractBalance(await prophets.getAddress())).to.be.equal(ethers.parseEther("1"));
      // should  be withdrawable via     function withdrawMaintenanceFee(address payable to) external onlyOwner {
      const randomAddress = await ethers.getAddress("0x1234567890123456789012345678901234567890");
      const tx = await prophets.withdrawMaintenanceFee(randomAddress);
      await expect(prophets.withdrawMaintenanceFee(randomAddress)).to.be.revertedWith("done");
      await tx.wait();
      // log user balance after
      const user1BalanceAfter2 = await provider.getBalance(await user1.getAddress());
      console.log(`user1BalanceAfterWithdrawMaintenanceFee: ${user1BalanceAfter2}`);
      expect(await testUtils.getContractBalance(await prophets.getAddress())).to.be.equal(ethers.parseEther("0"));
      expect(await testUtils.getAddressBalance(randomAddress)).to.be.equal(ethers.parseEther("1"));
    });
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
    it("testing iteration 3", async () => {
      currentEthPrice = 1000n * 10n ** 8n;
      // lets update the price
      const winnerPrediction = Math.floor(Number(currentEthPrice) * 10.5);
      const loserPrediction1 = Math.floor(Number(currentEthPrice) * 8.899);
      const loserPrediction2 = Math.floor(Number(currentEthPrice) * 11.101);

      // NEW PHASE, 2 WILL BE WRONG, AND BURNED
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      await prophets.connect(user1).makePrediction(3, loserPrediction1);
      await prophets.connect(user2).makePrediction(334, loserPrediction2);

      // lets check if metadata is correct, they all predicted bullish
      //tokenURI
      //"trait_type":"Prediction Direction" == true
      const tokenURI = await prophets.tokenURI(1);
      const base64Data = tokenURI.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata = JSON.parse(Buffer.from(base64Data, 'base64').toString());
      // Check attributes array for Prediction Direction
      const predictionAttr = metadata.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr?.value).to.equal("Bullish");
      
      const tokenURI2 = await prophets.tokenURI(3);
      const base64Data2 = tokenURI2.split(',')[1];
      const metadata2 = JSON.parse(Buffer.from(base64Data2, 'base64').toString());
      const predictionAttr2 = metadata2.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr2?.value).to.equal("Bullish");
      
      const tokenURI3 = await prophets.tokenURI(334);
      const base64Data3 = tokenURI3.split(',')[1];
      const metadata3 = JSON.parse(Buffer.from(base64Data3, 'base64').toString());
      const predictionAttr3 = metadata3.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr3?.value).to.equal("Bullish");

      // lets update price to 10k
      currentEthPrice = 10000n * 10n ** 8n;
      await mockPyth.connect(deployer).setPrice(currentEthPrice, -8);

      await advanceTime(24 * 60 * 60 * 7, deployer);
      await logTime("After advancing to next sunday", testUtils);
      await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      await expect(prophets.connect(user2).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      expect(await prophets.isBurned(1)).to.be.false;
      expect(await prophets.isBurned(3)).to.be.true;
      expect(await prophets.isBurned(334)).to.be.true;
      
      const tokenURI4 = await prophets.tokenURI(1);
      const base64Data4 = tokenURI4.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata4 = JSON.parse(Buffer.from(base64Data4, 'base64').toString());
      // Check attributes array for State (should be prophesizing since no prediction made in new cycle)
      const stateAttr4 = metadata4.attributes.find((attr: any) => attr.trait_type === "State");
      expect(stateAttr4?.value).to.equal("prophesizing");
      // ok make his final prediction
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      // fast forward to monday
      await advanceTime(24 * 60 * 60 * 2, deployer);
      await logTime("After advancing to tuesday", testUtils);
      await expect(prophets.connect(user2).acceptDivineBlessing(3)).to.be.revertedWith("Caller does not own the winning prophet");
      await expect(prophets.connect(user1).acceptDivineBlessing(3))
      // get winner
      const winner = await prophets.getWinner(3);
      expect(winner).to.equal(1);
    });
    it("testing iteration 4", async () => {
      currentEthPrice = 1000n * 10n ** 8n;
      // lets update the price
      const winnerPrediction = Math.floor(Number(currentEthPrice) * 0.095);
      const loserPrediction1 = Math.floor(Number(currentEthPrice) * 0.0899);
      const loserPrediction2 = Math.floor(Number(currentEthPrice) * 0.1101);

      // NEW PHASE, 2 WILL BE WRONG, AND BURNED
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      await prophets.connect(user1).makePrediction(3, loserPrediction1);
      await prophets.connect(user2).makePrediction(334, loserPrediction2);

      // lets check if metadata is correct, they all predicted bullish
      //tokenURI
      //"trait_type":"Prediction Direction" == true
      const tokenURI = await prophets.tokenURI(1);
      const base64Data = tokenURI.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata = JSON.parse(Buffer.from(base64Data, 'base64').toString());
      // Check attributes array for Prediction Direction
      const predictionAttr = metadata.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr?.value).to.equal("Bearish");
      
      const tokenURI2 = await prophets.tokenURI(3);
      const base64Data2 = tokenURI2.split(',')[1];
      const metadata2 = JSON.parse(Buffer.from(base64Data2, 'base64').toString());
      const predictionAttr2 = metadata2.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr2?.value).to.equal("Bearish");
      
      const tokenURI3 = await prophets.tokenURI(334);
      const base64Data3 = tokenURI3.split(',')[1];
      const metadata3 = JSON.parse(Buffer.from(base64Data3, 'base64').toString());
      const predictionAttr3 = metadata3.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr3?.value).to.equal("Bearish");

      // lets update price to 100
      currentEthPrice = 100n * 10n ** 8n;
      await mockPyth.connect(deployer).setPrice(currentEthPrice, -8);

      await advanceTime(24 * 60 * 60 * 7, deployer);
      await logTime("After advancing to next sunday", testUtils);
      await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      await expect(prophets.connect(user2).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      expect(await prophets.isBurned(1)).to.be.false;
      expect(await prophets.isBurned(3)).to.be.true;
      expect(await prophets.isBurned(334)).to.be.true;
      
      const tokenURI4 = await prophets.tokenURI(1);
      const base64Data4 = tokenURI4.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata4 = JSON.parse(Buffer.from(base64Data4, 'base64').toString());
      // Check attributes array for State (should be prophesizing since no prediction made in new cycle)
      const stateAttr4 = metadata4.attributes.find((attr: any) => attr.trait_type === "State");
      expect(stateAttr4?.value).to.equal("prophesizing");
      // ok make his final prediction
      await expect(prophets.connect(user1).makePrediction(1, currentEthPrice)).to.be.revertedWith("Prediction must differ by at least 1% from cycle start price");
      await prophets.connect(user1).makePrediction(1, winnerPrediction);
      // fast forward to monday
      await advanceTime(24 * 60 * 60 * 2, deployer);
      await logTime("After advancing to tuesday", testUtils);
      await expect(prophets.connect(user2).acceptDivineBlessing(3)).to.be.revertedWith("Caller does not own the winning prophet");
      await expect(prophets.connect(user1).acceptDivineBlessing(3))
      // get winner
      const winner = await prophets.getWinner(3);
      expect(winner).to.equal(1);
    });
    it("testing iteration 5", async () => {
      currentEthPrice = 1000n * 10n ** 8n;
      // lets update the price
      const loserPrediction = Math.floor(Number(currentEthPrice) * 10.5);
      const loserPrediction1 = Math.floor(Number(currentEthPrice) * 8.899);
      const loserPrediction2 = Math.floor(Number(currentEthPrice) * 11.101);

      // NEW PHASE, 2 WILL BE WRONG, AND BURNED
      await prophets.connect(user1).makePrediction(1, loserPrediction);
      await prophets.connect(user1).makePrediction(3, loserPrediction1);
      await prophets.connect(user2).makePrediction(334, loserPrediction2);
      // console log current cycle
      console.log(`Current cycle6969: ${await prophets.getCurrentCycle()}`);
      
      // lets update price to 100
      currentEthPrice = 999n * 10n ** 8n;
      await mockPyth.connect(deployer).setPrice(currentEthPrice, -8);

      // lets check if metadata is correct, they all predicted bullish
      //tokenURI
      //"trait_type":"Prediction Direction" == true
      const tokenURI = await prophets.tokenURI(1);
      const base64Data = tokenURI.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata = JSON.parse(Buffer.from(base64Data, 'base64').toString());
      // Check attributes array for Prediction Direction
      const predictionAttr = metadata.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr?.value).to.equal("Bullish");
      
      const tokenURI2 = await prophets.tokenURI(3);
      const base64Data2 = tokenURI2.split(',')[1];
      const metadata2 = JSON.parse(Buffer.from(base64Data2, 'base64').toString());
      const predictionAttr2 = metadata2.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr2?.value).to.equal("Bullish");
      
      const tokenURI3 = await prophets.tokenURI(334);
      const base64Data3 = tokenURI3.split(',')[1];
      const metadata3 = JSON.parse(Buffer.from(base64Data3, 'base64').toString());
      const predictionAttr3 = metadata3.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr3?.value).to.equal("Bullish");

      await advanceTime(24 * 60 * 60 * 7, deployer);
      await logTime("After advancing to next sunday", testUtils);
      await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      await expect(prophets.connect(user2).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      expect(await prophets.isBurned(1)).to.be.true;
      expect(await prophets.isBurned(3)).to.be.true;
      expect(await prophets.isBurned(334)).to.be.true;
      
      const tokenURI4 = await prophets.tokenURI(1);
      const base64Data4 = tokenURI4.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata4 = JSON.parse(Buffer.from(base64Data4, 'base64').toString());
      // Check attributes array for State (should be prophesizing since no prediction made in new cycle)
      const stateAttr4 = metadata4.attributes.find((attr: any) => attr.trait_type === "State");
      expect(stateAttr4?.value).to.equal("burned");
      // ok make his final prediction
      await expect(prophets.connect(user1).makePrediction(1, loserPrediction)).to.be.revertedWith("This prophet has been burned and cannot make predictions");
      // fast forward to monday
      await advanceTime(24 * 60 * 60 * 2, deployer);
      await logTime("After advancing to tuesday", testUtils);
      await expect(prophets.connect(user2).acceptDivineBlessing(2)).to.be.revertedWith("Caller does not own the winning prophet");
      await prophets.connect(user1).acceptDivineBlessing(2)
      // get winner
      const winner = await prophets.getWinner(2);
      expect(winner).to.equal(3);
    });
    it("testing iteration 6", async () => {
      currentEthPrice = 4000n * 10n ** 8n;
      // lets update the price
      const loserPrediction = Math.floor(Number(currentEthPrice) * 10.5);
      const loserPrediction1 = Math.floor(Number(currentEthPrice) * 8.899);
      const loserPrediction2 = Math.floor(Number(currentEthPrice) * 11.101);

      // NEW PHASE, 2 WILL BE WRONG, AND BURNED
      await prophets.connect(user1).makePrediction(1, loserPrediction);
      await prophets.connect(user1).makePrediction(3, loserPrediction1);
      await prophets.connect(user2).makePrediction(334, loserPrediction2);
      // console log current cycle
      console.log(`Current cycle6969: ${await prophets.getCurrentCycle()}`);

      // lets check if metadata is correct, they all predicted bullish
      //tokenURI
      //"trait_type":"Prediction Direction" == true
      const tokenURI = await prophets.tokenURI(1);
      const base64Data = tokenURI.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata = JSON.parse(Buffer.from(base64Data, 'base64').toString());
      // Check attributes array for Prediction Direction
      const predictionAttr = metadata.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr?.value).to.equal("Bullish");
      
      const tokenURI2 = await prophets.tokenURI(3);
      const base64Data2 = tokenURI2.split(',')[1];
      const metadata2 = JSON.parse(Buffer.from(base64Data2, 'base64').toString());
      const predictionAttr2 = metadata2.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr2?.value).to.equal("Bullish");
      
      const tokenURI3 = await prophets.tokenURI(334);
      const base64Data3 = tokenURI3.split(',')[1];
      const metadata3 = JSON.parse(Buffer.from(base64Data3, 'base64').toString());
      const predictionAttr3 = metadata3.attributes.find((attr: any) => attr.trait_type === "Prediction Direction");
      expect(predictionAttr3?.value).to.equal("Bullish");

      
      // lets update price to +1
      currentEthPrice = currentEthPrice + 1n
      await mockPyth.connect(deployer).setPrice(currentEthPrice, -8);

      await advanceTime(24 * 60 * 60 * 7, deployer);
      await logTime("After advancing to next sunday", testUtils);
      await expect(prophets.connect(user1).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      await expect(prophets.connect(user2).acceptDivineBlessing(1)).to.be.revertedWith("game-not-ended");
      expect(await prophets.isBurned(1)).to.be.true;
      expect(await prophets.isBurned(3)).to.be.true;
      expect(await prophets.isBurned(334)).to.be.true;
      
      const tokenURI4 = await prophets.tokenURI(1);
      const base64Data4 = tokenURI4.split(',')[1]; // Remove "data:application/json;base64," prefix
      const metadata4 = JSON.parse(Buffer.from(base64Data4, 'base64').toString());
      // Check attributes array for State (should be prophesizing since no prediction made in new cycle)
      const stateAttr4 = metadata4.attributes.find((attr: any) => attr.trait_type === "State");
      expect(stateAttr4?.value).to.equal("burned");
      // ok make his final prediction
      await expect(prophets.connect(user1).makePrediction(1, loserPrediction)).to.be.revertedWith("This prophet has been burned and cannot make predictions");
      // fast forward to monday
      await advanceTime(24 * 60 * 60 * 2, deployer);
      await logTime("After advancing to tuesday", testUtils);
      
      const winner = await prophets.getWinner(2);
      expect(winner).to.equal(334);

      await expect(prophets.connect(user1).acceptDivineBlessing(2)).to.be.revertedWith("Caller does not own the winning prophet");
      await prophets.connect(user2).acceptDivineBlessing(2)
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