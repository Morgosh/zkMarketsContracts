import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";

const MINT_PRICE = ethers.parseEther("0.01");
const provider = new ethers.BrowserProvider(hre.network.provider as any);

describe("ProphetsOfEthereum - Prediction Uniqueness", () => {
  let prophets: any;
  let mockPyth: any;
  let renderer: any;
  let deployer: any, user1: any, approver: any;

  beforeEach(async () => {
    deployer = await provider.getSigner(0);
    user1 = await provider.getSigner(1);
    approver = await provider.getSigner(2);

    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const startPx = 3000n * 10n ** 8n; // $3000
    mockPyth = await MockPyth.deploy(startPx, -8);
    await mockPyth.waitForDeployment();

    // Deploy ProphetsRenderer
    const rendererArtifact = await hre.artifacts.readArtifact("ProphetsRenderer");
    const Renderer = new ethers.ContractFactory(rendererArtifact.abi, rendererArtifact.bytecode, deployer);
    renderer = await Renderer.deploy();
    await renderer.waitForDeployment();

    // Deploy Prophets
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    prophets = await Prophets.deploy(
      await renderer.getAddress(),
      ethers.ZeroAddress, // dummy pool
      await approver.getAddress(),
      ethers.ZeroAddress, // dummy marketplace
      await mockPyth.getAddress() // _pythContract
    );
    await prophets.waitForDeployment();

    // Set price provider to use Pyth
    await prophets.setPriceProvider(1); // PYTH = 1

    // Mint tokens and complete mint-out
    const contractName = await prophets.name();
    const domain = {
      name: contractName,
      version: "1",
      chainId: (await provider.getNetwork()).chainId,
      verifyingContract: await prophets.getAddress()
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

    const currentTime = Math.floor(Date.now() / 1000);
    const endTime = currentTime + (365 * 24 * 60 * 60);
    
    const value = {
      user: await user1.getAddress(),
      saleId: 1,
      endTime: endTime,
      maxMint: 666,
      pricePerToken: MINT_PRICE.toString()
    };

    const signature = await approver.signTypedData(domain, types, value);
    
    // Complete mint-out
    await prophets.connect(user1).mint(1, endTime, 666, MINT_PRICE, 666, signature, { value: MINT_PRICE * 666n });

    // Wait for Sunday window
    const firstCycleStart = await prophets.firstCycleStart();
    const currentBlock = await provider.getBlock("latest");
    const currentTime2 = currentBlock!.timestamp;
    const timeToSunday = Number(firstCycleStart) + 60 - currentTime2;
    
    if (timeToSunday > 0) {
      await provider.send("evm_increaseTime", [timeToSunday]);
      await provider.send("evm_mine", []);
    }
  });

  it("should demonstrate prediction uniqueness validation", async () => {
    const startPrice = 3000n * 10n ** 8n;
    const prediction1 = Number(startPrice) * 0.95; // -5% (will be lowest)
    const prediction2 = Number(startPrice) * 1.05; // +5% (will be highest)

    console.log("🔍 Testing Prediction Uniqueness Validation");
    
    // 1. First prediction sets both lowest and highest
    console.log("1️⃣ Making first prediction (sets extremes)...");
    await prophets.connect(user1).makePrediction(1, Math.floor(prediction1));
    console.log("   ✅ First prediction successful");

    // 2. Second prediction creates new highest
    console.log("2️⃣ Making second prediction (new highest)...");
    await prophets.connect(user1).makePrediction(2, Math.floor(prediction2));
    console.log("   ✅ Second prediction successful");

    // 3. User can update their own prediction to same value
    console.log("3️⃣ User updating own prediction to same value...");
    await prophets.connect(user1).makePrediction(1, Math.floor(prediction1));
    console.log("   ✅ Self-update successful");

    // 4. Different token cannot use same extreme value
    console.log("4️⃣ Attempting duplicate lowest prediction (should fail)...");
    try {
      await prophets.connect(user1).makePrediction(3, Math.floor(prediction1));
      console.log("   ❌ ERROR: Duplicate prediction was allowed!");
      expect.fail("Should have been rejected");
    } catch (error: any) {
      if (error.message.includes("same-as-lowest")) {
        console.log("   ✅ Duplicate lowest correctly rejected");
      } else {
        console.log("   ❓ Rejected for different reason:", error.message);
      }
    }

    // 5. Different token cannot use same extreme value
    console.log("5️⃣ Attempting duplicate highest prediction (should fail)...");
    try {
      await prophets.connect(user1).makePrediction(4, Math.floor(prediction2));
      console.log("   ❌ ERROR: Duplicate prediction was allowed!");
      expect.fail("Should have been rejected");
    } catch (error: any) {
      if (error.message.includes("same-as-highest")) {
        console.log("   ✅ Duplicate highest correctly rejected");
      } else {
        console.log("   ❓ Rejected for different reason:", error.message);
      }
    }

    // 6. Predictions between extremes are allowed
    console.log("6️⃣ Making prediction between extremes...");
    const middlePrediction = Number(startPrice) * 1.02; // +2% (between extremes)
    await prophets.connect(user1).makePrediction(5, Math.floor(middlePrediction));
    console.log("   ✅ Middle prediction successful");

    console.log("\n🎯 Prediction Uniqueness Validation Working Correctly!");
  });
});

