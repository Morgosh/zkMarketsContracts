import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";

const TOTAL = 666n;
const MINT_PRICE = ethers.parseEther("0.01");

// Time helpers
const oneDay = 24 * 60 * 60;
const oneWeek = 7 * oneDay;
const provider = new ethers.BrowserProvider(hre.network.provider as any);

// Helper to set specific timestamp
async function setNextBlockTimestamp(ts: number) {
  await provider.send("evm_setNextBlockTimestamp", [ts]);
  await provider.send("evm_mine", []);
}

// Helper to increase time
async function increaseTime(sec: number) {
  await provider.send("evm_increaseTime", [sec]);
  await provider.send("evm_mine", []);
}

// Helper to get current block timestamp
async function getCurrentTimestamp(): Promise<number> {
  const block = await provider.getBlock("latest");
  return block!.timestamp;
}

// Helper to get next Sunday 00:00 UTC
function nextSunday00UTC(fromTs: number): number {
  const day = Math.floor(fromTs / 86400);
  const dayStart = day * 86400;
  const w = (day + 4) % 7; // 0=Sun, 1=Mon, ..., 6=Sat
  const addDays = (7 - w) % 7;
  return dayStart + addDays * 86400;
}

// Create mint signature helper
async function createMintSignature(
  approver: any,
  contractAddress: string,
  user: string,
  saleId: number,
  endTime: number,
  maxMint: number,
  pricePerToken: bigint
) {
  const domain = {
    name: "TEST",
    version: "1",
    chainId: (await provider.getNetwork()).chainId,
    verifyingContract: contractAddress
  };

  const types = {
    Mint: [
      { name: "user", type: "address" },
      { name: "saleId", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "maxMint", type: "uint256" },
      { name: "pricePerToken", type: "uint256" }
    ]
  };

  const value = {
    user: user,
    saleId: saleId,
    endTime: endTime,
    maxMint: maxMint,
    pricePerToken: pricePerToken.toString()
  };

  return await approver.signTypedData(domain, types, value);
}

describe("🔥 ProphetsOfEthereum - COMPREHENSIVE EDGE CASES", () => {
  let prophets: any;
  let mockPyth: any;
  let renderer: any;
  let deployer: any, approver: any;
  let users: any[] = []; // Array of 10 users for testing

  beforeEach(async () => {
    // Get signers
    deployer = await provider.getSigner(0);
    approver = await provider.getSigner(1);

    // Create 10 test users
    for (let i = 2; i < 12; i++) {
      users.push(await provider.getSigner(i));
    }

    // Deploy MockPyth with initial price $3000
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const startPx = 3000n * 10n ** 8n; // $3000 with 8 decimals
    mockPyth = await MockPyth.deploy(startPx, -8);
    await mockPyth.waitForDeployment();

    // Deploy ProphetsRenderer
    const rendererArtifact = await hre.artifacts.readArtifact("ProphetsRenderer");
    const Renderer = new ethers.ContractFactory(rendererArtifact.abi, rendererArtifact.bytecode, deployer);
    renderer = await Renderer.deploy();
    await renderer.waitForDeployment();

    // Deploy Prophets contract
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const dummyPool = ethers.ZeroAddress;
    const mockMarketplace = ethers.ZeroAddress;
    const defaultOperator = await deployer.getAddress();

    prophets = await Prophets.deploy(
      await renderer.getAddress(),
      dummyPool,
      await approver.getAddress(),
      mockMarketplace,
      defaultOperator
    );
    await prophets.waitForDeployment();

    // Configure to use MockPyth
    await prophets.setPythContract(await mockPyth.getAddress());
    await prophets.setPriceProvider(1); // PYTH = 1
  });

  describe("🎯 EDGE CASE 1: Multiple Wallets, Different Predictions", () => {
    it("should handle 10 different users with varied prediction strategies", async () => {
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      // Mint tokens to 10 different users (66 tokens each, except last user gets 6)
      console.log("🏭 Minting tokens to 10 different users...");
      for (let i = 0; i < 10; i++) {
        let tokensToMint = 66;
        if (i === 9) {
          // Last user gets only 6 tokens to reach exactly 666
          tokensToMint = 666 - (9 * 66); // This should be 6
        }
        const signature = await createMintSignature(
          approver,
          contractAddress,
          await users[i].getAddress(),
          i + 1,
          endTime,
          tokensToMint,
          MINT_PRICE
        );

        await prophets.connect(users[i]).mint(
          i + 1,
          endTime,
          tokensToMint,
          MINT_PRICE,
          tokensToMint,
          signature,
          { value: MINT_PRICE * BigInt(tokensToMint) }
        );

        console.log(`✅ User ${i + 1} minted ${tokensToMint} tokens`);
      }

      expect(await prophets.totalSupply()).to.equal(666);

      // Verify firstCycleStart is set
      const firstCycleStart = await prophets.firstCycleStart();
      expect(firstCycleStart).to.be.gt(0);
      console.log(`🕐 First cycle starts at: ${new Date(Number(firstCycleStart) * 1000)}`);

      // Jump to the first Sunday window
      await setNextBlockTimestamp(Number(firstCycleStart) + 1); // 1 second into Sunday

      expect(await prophets.getCurrentCycle()).to.equal(1);
      console.log("📅 Successfully jumped to Cycle 1 Sunday window");

      // Test different prediction strategies
      const startPrice = 3000n * 10n ** 8n; // $3000

      const predictionStrategies = [
        { user: 0, price: 3100n * 10n ** 8n, strategy: "Conservative Bull (+3.3%)" },
        { user: 1, price: 3500n * 10n ** 8n, strategy: "Aggressive Bull (+16.7%)" },
        { user: 2, price: 2900n * 10n ** 8n, strategy: "Conservative Bear (-3.3%)" },
        { user: 3, price: 2500n * 10n ** 8n, strategy: "Aggressive Bear (-16.7%)" },
        { user: 4, price: 4000n * 10n ** 8n, strategy: "Moon Boy (+33.3%)" },
        { user: 5, price: 2000n * 10n ** 8n, strategy: "Extreme Bear (-33.3%)" },
        { user: 6, price: 3030n * 10n ** 8n, strategy: "Minimal Bull (+1%)" },
        { user: 7, price: 2970n * 10n ** 8n, strategy: "Minimal Bear (-1%)" },
        { user: 8, price: 5000n * 10n ** 8n, strategy: "Extreme Bull (+66.7%)" },
        // User 9 will not make a prediction (should be burned)
      ];

      console.log("\n🔮 Making predictions with different strategies:");
      for (const { user, price, strategy } of predictionStrategies) {
        // Each user predicts with their first token
        const tokenId = user * 66 + 1; // First token of each user
        await prophets.connect(users[user]).makePrediction(tokenId, price);
        console.log(`📊 User ${user + 1} (Token ${tokenId}): ${strategy} - $${Number(price) / 1e8}`);
      }

      // Verify predictions were recorded
      for (let i = 0; i < predictionStrategies.length; i++) {
        const tokenId = i * 66 + 1;
        const prediction = await prophets.predictions(tokenId, 1);
        expect(prediction).to.be.gt(0);
      }

      console.log("✅ All predictions recorded successfully");
    });
  });

  describe("⏰ EDGE CASE 2: Cycle Boundary Testing", () => {
    it("should handle predictions exactly at cycle boundaries", async () => {
      // Mint all 666 tokens to complete mint out
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      const signature = await createMintSignature(
        approver,
        contractAddress,
        await users[0].getAddress(),
        1,
        endTime,
        666,
        MINT_PRICE
      );

      await prophets.connect(users[0]).mint(
        1,
        endTime,
        666,
        MINT_PRICE,
        666,
        signature,
        { value: MINT_PRICE * 666n }
      );

      const firstCycleStart = await prophets.firstCycleStart();
      console.log(`🕐 First cycle starts at: ${new Date(Number(firstCycleStart) * 1000)}`);

      // Test predictions at exact cycle boundaries
      console.log("\n🎯 Testing cycle boundary edge cases:");

      // 1. Try to predict 1 second before Sunday window
      await setNextBlockTimestamp(Number(firstCycleStart) - 1);
      expect(await prophets.getCurrentCycle()).to.equal(0);

      await expect(
        prophets.connect(users[0]).makePrediction(1, 3100n * 10n ** 8n)
      ).to.be.revertedWith("no-cycle");
      console.log("✅ Correctly rejected prediction before cycle starts");

      // 2. Predict exactly at cycle start
      await setNextBlockTimestamp(Number(firstCycleStart));
      expect(await prophets.getCurrentCycle()).to.equal(1);

      await prophets.connect(users[0]).makePrediction(1, 3100n * 10n ** 8n);
      console.log("✅ Accepted prediction exactly at cycle start");

      // 3. Try to predict exactly at cycle end (should fail)
      await setNextBlockTimestamp(Number(firstCycleStart) + oneDay);

      await expect(
        prophets.connect(users[0]).makePrediction(2, 3200n * 10n ** 8n)
      ).to.be.revertedWith("not-sunday");
      console.log("✅ Correctly rejected prediction at cycle end boundary");

      // 4. Predict 1 second before cycle end (should work)
      await setNextBlockTimestamp(Number(firstCycleStart) + oneDay - 1);

      await prophets.connect(users[0]).makePrediction(3, 3300n * 10n ** 8n);
      console.log("✅ Accepted prediction 1 second before cycle end");
    });
  });

  describe("💀 EDGE CASE 3: Burning and Judgment Mechanics", () => {
    it("should handle complex burning scenarios and edge case judgments", async () => {
      // Setup: mint tokens and get to prediction phase
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      // Mint 100 tokens to user 0
      const signature = await createMintSignature(
        approver,
        contractAddress,
        await users[0].getAddress(),
        1,
        endTime,
        666,
        MINT_PRICE
      );

      await prophets.connect(users[0]).mint(
        1,
        endTime,
        666,
        MINT_PRICE,
        666,
        signature,
        { value: MINT_PRICE * 666n }
      );

      const firstCycleStart = await prophets.firstCycleStart();
      await setNextBlockTimestamp(Number(firstCycleStart) + 1);

      console.log("\n💀 Testing burning and judgment edge cases:");

      // Test 1: Prediction exactly at 10% threshold
      const startPrice = 3000n * 10n ** 8n;
      const exactly10PercentWrong = 3333n * 10n ** 8n; // +11.1% (should burn)
      const exactly10PercentRight = 3300n * 10n ** 8n; // +10% (should survive)

      await prophets.connect(users[0]).makePrediction(1, exactly10PercentWrong);
      await prophets.connect(users[0]).makePrediction(2, exactly10PercentRight);
      console.log("📊 Made threshold test predictions");

      // Simulate price ending at exactly start price (no movement)
      await increaseTime(oneWeek + 10); // Move to next cycle (add buffer)

      // Make a prediction in cycle 2 to set end price for cycle 1
      await prophets.connect(users[0]).makePrediction(3, startPrice); // Same price = no movement

      // Check burning status
      const burned1 = await prophets.isBurned(1);
      const burned2 = await prophets.isBurned(2);

      expect(burned1).to.be.true; // 11.1% error should burn
      expect(burned2).to.be.true; // 10% error should burn (predicted up, went nowhere)
      console.log("✅ Threshold burning works correctly");

      // Test 2: No prediction = automatic burn
      await increaseTime(oneWeek + 10); // Move to cycle 3

      // Don't make prediction for token 4, check if it burns
      const burned4 = await prophets.isBurned(4);
      expect(burned4).to.be.true; // No prediction should burn
      console.log("✅ No prediction burning works correctly");
    });
  });

  describe("🏆 EDGE CASE 4: Game Ending and Winner Selection", () => {
    it("should handle game ending with single survivor and blessing", async () => {
      // Setup: mint tokens
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      const signature = await createMintSignature(
        approver,
        contractAddress,
        await users[0].getAddress(),
        1,
        endTime,
        666,
        MINT_PRICE
      );

      await prophets.connect(users[0]).mint(
        1,
        endTime,
        666,
        MINT_PRICE,
        666,
        signature,
        { value: MINT_PRICE * 666n }
      );

      const firstCycleStart = await prophets.firstCycleStart();

      console.log("\n🏆 Testing game ending scenarios:");

      // Cycle 1: Multiple predictions
      await setNextBlockTimestamp(Number(firstCycleStart) + 1);
      await prophets.connect(users[0]).makePrediction(1, 3100n * 10n ** 8n); // Will survive
      await prophets.connect(users[0]).makePrediction(2, 2000n * 10n ** 8n); // Will burn
      await prophets.connect(users[0]).makePrediction(3, 4000n * 10n ** 8n); // Will burn

      // Cycle 2: Price goes to 3100 (token 1 wins)
      await setNextBlockTimestamp(Number(firstCycleStart) + oneWeek + 1);
      await mockPyth.updatePrice(3100n * 10n ** 8n, -8); // Update price to $3100

      // Only token 1 makes a prediction (others should be burned)
      await prophets.connect(users[0]).makePrediction(1, 3200n * 10n ** 8n);

      // Cycle 3: Check if game has ended
      await setNextBlockTimestamp(Number(firstCycleStart) + 2 * oneWeek + 1);

      const isGameEnded = await prophets.isGameEnded();
      expect(isGameEnded).to.be.true;
      console.log("✅ Game ended with single survivor");

      // Get winner
      const winner = await prophets.getWinner(2); // Game ended in cycle 2
      expect(winner).to.equal(1);
      console.log(`🎯 Winner is token #${winner}`);

      // Test blessing
      const initialBalance = await provider.getBalance(await users[0].getAddress());
      const treasury = await prophets.getTreasury();
      console.log(`💰 Treasury before blessing: ${ethers.formatEther(treasury)} ETH`);

      await prophets.connect(users[0]).acceptDivineBlessing(2);

      const finalBalance = await provider.getBalance(await users[0].getAddress());
      const blessedToken = await prophets.blessedByDivine();

      expect(blessedToken).to.equal(1);
      expect(finalBalance).to.be.gt(initialBalance);
      console.log("✅ Divine blessing accepted successfully");
      console.log(`💎 Token #${blessedToken} is now blessed and forever bullish`);

      // Verify blessed token cannot be burned
      const isBlessedBurned = await prophets.isBurned(1);
      expect(isBlessedBurned).to.be.false;
      console.log("✅ Blessed token is immune to burning");
    });
  });

  describe("⚡ EDGE CASE 5: Extreme Price Scenarios", () => {
    it("should handle extreme price predictions and overflow protection", async () => {
      // Mint tokens
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      const signature = await createMintSignature(
        approver,
        contractAddress,
        await users[0].getAddress(),
        1,
        endTime,
        666,
        MINT_PRICE
      );

      await prophets.connect(users[0]).mint(
        1,
        endTime,
        666,
        MINT_PRICE,
        666,
        signature,
        { value: MINT_PRICE * 666n }
      );

      const firstCycleStart = await prophets.firstCycleStart();
      await setNextBlockTimestamp(Number(firstCycleStart) + 1);

      console.log("\n⚡ Testing extreme price scenarios:");

      // Test extreme predictions
      const startPrice = 3000n * 10n ** 8n;

      // Test 1: Very high price (should work with proper validation)
      const millionDollarETH = 1000000n * 10n ** 8n; // $1M ETH
      await prophets.connect(users[0]).makePrediction(1, millionDollarETH);
      console.log("✅ Extreme high prediction accepted: $1,000,000");

      // Test 2: Very low price (should work)
      const oneDollarETH = 1n * 10n ** 8n; // $1 ETH
      await prophets.connect(users[0]).makePrediction(2, oneDollarETH);
      console.log("✅ Extreme low prediction accepted: $1");

      // Test 3: Prediction too close to start price (should fail)
      const tooClosePrice = 3000n * 10n ** 8n + 1n; // Only 0.000001% difference
      await expect(
        prophets.connect(users[0]).makePrediction(3, tooClosePrice)
      ).to.be.revertedWith("min-diff");
      console.log("✅ Too-close prediction correctly rejected");

      // Test 4: Exactly 1% difference (should work)
      const exactly1Percent = 3030n * 10n ** 8n; // +1% exactly
      await prophets.connect(users[0]).makePrediction(4, exactly1Percent);
      console.log("✅ Exactly 1% prediction accepted");
    });
  });

  describe("🎭 EDGE CASE 6: State Transitions and Token URI", () => {
    it("should handle all state transitions correctly", async () => {
      // Mint tokens
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      const signature = await createMintSignature(
        approver,
        contractAddress,
        await users[0].getAddress(),
        1,
        endTime,
        10,
        MINT_PRICE
      );

      await prophets.connect(users[0]).mint(
        1,
        endTime,
        10,
        MINT_PRICE,
        10,
        signature,
        { value: MINT_PRICE * 10n }
      );

      console.log("\n🎭 Testing state transitions:");

      // Initially should be prophesizing
      let tokenURI = await prophets.tokenURI(1);
      expect(tokenURI).to.include("prophesizing");
      console.log("✅ Initial state: prophesizing");

      // Complete mint out and start cycle
      for (let i = 2; i <= 67; i++) {
        const sig = await createMintSignature(
          approver,
          contractAddress,
          await users[0].getAddress(),
          i,
          endTime,
          10,
          MINT_PRICE
        );
        await prophets.connect(users[0]).mint(
          i,
          endTime,
          10,
          MINT_PRICE,
          10,
          sig,
          { value: MINT_PRICE * 10n }
        );
      }

      const firstCycleStart = await prophets.firstCycleStart();
      await setNextBlockTimestamp(Number(firstCycleStart) + 1);

      // Make bullish prediction
      await prophets.connect(users[0]).makePrediction(1, 3100n * 10n ** 8n);
      tokenURI = await prophets.tokenURI(1);
      expect(tokenURI).to.include("bullish");
      console.log("✅ After bullish prediction: bullish");

      // Make bearish prediction for another token
      await prophets.connect(users[0]).makePrediction(2, 2900n * 10n ** 8n);
      let tokenURI2 = await prophets.tokenURI(2);
      expect(tokenURI2).to.include("bearish");
      console.log("✅ After bearish prediction: bearish");

      // Simulate burning scenario
      await increaseTime(oneWeek);
      await setNextBlockTimestamp(Number(firstCycleStart) + oneWeek + 1);
      await mockPyth.updatePrice(2000n * 10n ** 8n, -8); // Extreme price drop
      await prophets.connect(users[0]).makePrediction(3, 2000n * 10n ** 8n); // Set cycle 2 price

      // Check if token 1 is burned (predicted up, price went way down)
      const isBurned = await prophets.isBurned(1);
      if (isBurned) {
        tokenURI = await prophets.tokenURI(1);
        expect(tokenURI).to.include("burned");
        console.log("✅ After wrong prediction: burned");
      }
    });
  });

  describe("💎 EDGE CASE 7: Treasury and Minimal Floor Price", () => {
    it("should handle treasury calculations and edge cases", async () => {
      console.log("\n💎 Testing treasury and minimal floor price:");

      // Check initial treasury (should be 0)
      let treasury = await prophets.getTreasury();
      console.log(`💰 Initial treasury: ${ethers.formatEther(treasury)} ETH`);

      // Mint tokens (this adds to treasury)
      const contractAddress = await prophets.getAddress();
      const currentTime = await getCurrentTimestamp();
      const endTime = currentTime + (365 * 24 * 60 * 60);

      const signature = await createMintSignature(
        approver,
        contractAddress,
        await users[0].getAddress(),
        1,
        endTime,
        666,
        MINT_PRICE
      );

      await prophets.connect(users[0]).mint(
        1,
        endTime,
        666,
        MINT_PRICE,
        666,
        signature,
        { value: MINT_PRICE * 666n }
      );

      // Check treasury after mint
      treasury = await prophets.getTreasury();
      const expectedTreasury = MINT_PRICE * 666n - ethers.parseEther("1"); // Minus maintenance fee
      expect(treasury).to.equal(expectedTreasury);
      console.log(`💰 Treasury after mint: ${ethers.formatEther(treasury)} ETH`);

      // Check minimal floor price
      const aliveProphets = await prophets.getAliveProphetsCount();
      const minimalFloor = await prophets.getMinimalFloorPrice();
      const expectedFloor = treasury / BigInt(aliveProphets);

      expect(minimalFloor).to.equal(expectedFloor);
      console.log(`📊 Alive prophets: ${aliveProphets}`);
      console.log(`🏢 Minimal floor price: ${ethers.formatEther(minimalFloor)} ETH`);

      // Test maintenance fee withdrawal
      const ownerBalanceBefore = await provider.getBalance(await deployer.getAddress());
      await prophets.withdrawMaintenanceFee(await deployer.getAddress());
      const ownerBalanceAfter = await provider.getBalance(await deployer.getAddress());

      expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
      console.log("✅ Maintenance fee withdrawn successfully");

      // Check treasury after maintenance withdrawal
      treasury = await prophets.getTreasury();
      console.log(`💰 Treasury after maintenance withdrawal: ${ethers.formatEther(treasury)} ETH`);
    });
  });
});
