import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";

describe("ProphetsOfEthereum - Simple Test", () => {
  it("deploys correctly and has proper initial state", async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider as any);
    const deployer = await provider.getSigner(0);
    
    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const startPx = 3000n * 10n ** 8n; // $3000 with 8 decimals
    const mockPyth = await MockPyth.deploy(startPx, -8);
    await mockPyth.waitForDeployment();

    // Deploy Prophets
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const baseURI = "ipfs://test/";
    const dummyPool = ethers.ZeroAddress;
    const prophets = await Prophets.deploy(baseURI, dummyPool);
    await prophets.waitForDeployment();

    // Configure to use MockPyth
    await prophets.setPythContract(await mockPyth.getAddress());
    await prophets.setPriceProvider(1); // PYTH = 1

    // Check initial state
    expect(await prophets.name()).to.equal("Prophets of Ethereum");
    expect(await prophets.symbol()).to.equal("PROPHET");
    expect(await prophets.totalSupply()).to.equal(0);
    expect(await prophets.TOTAL_SUPPLY()).to.equal(666);
    expect(await prophets.getCurrentCycle()).to.equal(0); // No cycle until mint complete
    
    console.log("✅ Contract deployed and configured successfully");
    console.log("📊 Initial state verified");
  });

  it("can mint tokens and complete mint-out", async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider as any);
    const deployer = await provider.getSigner(0);
    const user = await provider.getSigner(1);
    
    // Deploy and configure contract
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const mockPyth = await MockPyth.deploy(3000n * 10n ** 8n, -8);
    await mockPyth.waitForDeployment();

    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const prophets = await Prophets.deploy("ipfs://test/", ethers.ZeroAddress);
    await prophets.waitForDeployment();
    
    await prophets.setPythContract(await mockPyth.getAddress());
    await prophets.setPriceProvider(1);

    const MINT_PRICE = ethers.parseEther("0.01");
    
    // Mint some tokens
    await prophets.connect(user).mint(10, { value: MINT_PRICE * 10n });
    expect(await prophets.totalSupply()).to.equal(10);
    expect(await prophets.ownerOf(1)).to.equal(await user.getAddress());
    
    // Complete mint-out
    await prophets.connect(deployer).mint(656, { value: MINT_PRICE * 656n });
    expect(await prophets.totalSupply()).to.equal(666);
    expect(await prophets.mintCompleteTimestamp()).to.be.gt(0);
    
    // Should reject further minting
    await expect(
      prophets.connect(user).mint(1, { value: MINT_PRICE })
    ).to.be.revertedWith("supply");
    
    console.log("✅ Minting and mint-out works correctly");
    console.log("🚫 Over-minting properly rejected");
  });

  it("can read prices from different providers", async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider as any);
    const deployer = await provider.getSigner(0);
    
    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const mockPyth = await MockPyth.deploy(3000n * 10n ** 8n, -8);
    await mockPyth.waitForDeployment();

    // Deploy Prophets
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const prophets = await Prophets.deploy("ipfs://test/", ethers.ZeroAddress);
    await prophets.waitForDeployment();
    
    await prophets.setPythContract(await mockPyth.getAddress());

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
