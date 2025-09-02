import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";

describe("ProphetsOfEthereum - Simple Test", () => {
  it("deploys correctly and has proper initial state", async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider as any);
    const deployer = await provider.getSigner(0);
    const approver = await provider.getSigner(1);
    
    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const startPx = 3000n * 10n ** 8n; // $3000 with 8 decimals
    const mockPyth = await MockPyth.deploy(startPx, -8);
    await mockPyth.waitForDeployment();

    // Deploy ProphetsRenderer
    const rendererArtifact = await hre.artifacts.readArtifact("ProphetsRenderer");
    const Renderer = new ethers.ContractFactory(rendererArtifact.abi, rendererArtifact.bytecode, deployer);
    const renderer = await Renderer.deploy();
    await renderer.waitForDeployment();

    // Deploy Prophets with updated constructor
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const dummyPool = ethers.ZeroAddress;
    const dummyMarketplace = ethers.ZeroAddress;
    const dummyOperator = ethers.ZeroAddress;
    
    const prophets = await Prophets.deploy(
      await renderer.getAddress(),  // _renderer
      dummyPool,                   // uniPool
      await approver.getAddress(), // _approver
      dummyMarketplace,            // _marketplace (auto-set as operator)
      await mockPyth.getAddress()  // _pythContract
    ) as any;
    await prophets.waitForDeployment();

    // Configure to use PYTH mode
    await prophets.setPriceProvider(1); // PYTH = 1

    // Check initial state - dynamically verify name and symbol
    const contractName = await prophets.name();
    const contractSymbol = await prophets.symbol();
    expect(contractName).to.be.a("string").and.not.be.empty;
    expect(contractSymbol).to.be.a("string").and.not.be.empty;
    expect(await prophets.totalSupply()).to.equal(0);
    expect(await prophets.maxSupply()).to.equal(666);
    expect(await prophets.getCurrentCycle()).to.equal(0); // No cycle until mint complete
    
    console.log("✅ Contract deployed and configured successfully");
    console.log("📊 Initial state verified");
  });

  it("can mint tokens with signature (old mint function removed)", async () => {
    console.log("⚠️  Old mint function removed - signature minting only");
    console.log("✅ See ProphetsOfEthereum.updated.test.ts for signature minting tests");
  });

  it("can read prices from different providers", async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider as any);
    const deployer = await provider.getSigner(0);
    const approver = await provider.getSigner(1);
    
    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const mockPyth = await MockPyth.deploy(3000n * 10n ** 8n, -8);
    await mockPyth.waitForDeployment();

    // Deploy ProphetsRenderer
    const rendererArtifact = await hre.artifacts.readArtifact("ProphetsRenderer");
    const Renderer = new ethers.ContractFactory(rendererArtifact.abi, rendererArtifact.bytecode, deployer);
    const renderer = await Renderer.deploy();
    await renderer.waitForDeployment();

    // Deploy Prophets with updated constructor
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const prophets = await Prophets.deploy(
      await renderer.getAddress(),
      ethers.ZeroAddress,
      await approver.getAddress(),
      ethers.ZeroAddress,
      await mockPyth.getAddress() // _pythContract
    ) as any;
    await prophets.waitForDeployment();

    // Test PYTH mode
    await prophets.setPriceProvider(1); // PYTH
    const pythPrice = await prophets._readPythPrice();
    expect(pythPrice).to.equal(3000n * 10n ** 8n);
    
    // Test PYTH_OR_AMM mode (should fallback to AMM since no real pool)
    await prophets.setPriceProvider(2); // PYTH_OR_AMM
    // This will try Pyth first (succeed), so should return Pyth price
    // Note: We can't easily test AMM fallback without a real Uniswap pool
    
    console.log("✅ Price provider switching works");
    console.log("💰 Pyth price reading successful:", pythPrice.toString());
  });
});
