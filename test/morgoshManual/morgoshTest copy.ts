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



describe("ProphetsOfEthereum - Signature Minting Tests", () => {
  let prophets: any;
  let mockPyth: any;
  let deployer: any, user1: any, user2: any, approver: any;

  beforeEach(async () => {
    deployer = await provider.getSigner(0);
    user1 = await provider.getSigner(1);
    user2 = await provider.getSigner(2);
    approver = await provider.getSigner(3);

    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const startPx = 3000n * 10n ** 8n; // $3000
    mockPyth = await MockPyth.deploy(startPx, -8);
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
    it("should mint with valid signature", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + (365 * 24 * 60 * 60); // 1 year from now
      const saleId = 1;
      const maxMint = 667;
      const pricePerToken = MINT_PRICE;
      const actualMintAmount = 333;

      const signature = await createMintSignature(
        approver,
        prophets,
        await user1.getAddress(),
        saleId,
        endTime,
        maxMint,
        pricePerToken
      );

      await expect(
        prophets.connect(user1).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          actualMintAmount,
          signature,
          { value: pricePerToken * BigInt(actualMintAmount) }
        )
      ).to.not.be.reverted;

      expect(await prophets.totalSupply()).to.equal(actualMintAmount);
      expect(await prophets.balanceOf(await user1.getAddress())).to.equal(actualMintAmount);
    });

    it("should reject invalid signature", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + (365 * 24 * 60 * 60);
      const saleId = 1;
      const maxMint = 5;
      const pricePerToken = MINT_PRICE;
      const amount = 2;

      // Create signature with wrong signer (user2 instead of approver)
      const invalidSignature = await createMintSignature(
        user2, // Wrong signer
        prophets,
        await user1.getAddress(),
        saleId,
        endTime,
        maxMint,
        pricePerToken
      );

      await expect(
        prophets.connect(user1).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          amount,
          invalidSignature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.be.revertedWith("Invalid signature");
    });

    it("should enforce max mint per sale", async () => {
      const contractAddress = await prophets.getAddress();
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + (365 * 24 * 60 * 60);
      const saleId = 1;
      const maxMint = 3;
      const pricePerToken = MINT_PRICE;

      const signature = await createMintSignature(
        approver,
        prophets,
        await user1.getAddress(),
        saleId,
        endTime,
        maxMint,
        pricePerToken
      );

      // First mint: 2 tokens (should work)
      await prophets.connect(user1).mint(
        saleId,
        endTime,
        maxMint,
        pricePerToken,
        2,
        signature,
        { value: pricePerToken * 2n }
      );

      // Second mint: 2 more tokens (should fail, exceeds maxMint of 3)
      await expect(
        prophets.connect(user1).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          2,
          signature,
          { value: pricePerToken * 2n }
        )
      ).to.be.revertedWith("Exceeds max mint for this sale");
    });

    it("should set firstCycleStart when mint completes", async () => {
      const contractAddress = await prophets.getAddress();
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + (365 * 24 * 60 * 60);
      const saleId = 1;
      const maxMint = 666;
      const pricePerToken = MINT_PRICE;

      const signature = await createMintSignature(
        approver,
        prophets,
        await user1.getAddress(),
        saleId,
        endTime,
        maxMint,
        pricePerToken
      );

      // Mint all 666 tokens to complete mint-out
      await prophets.connect(user1).mint(
        saleId,
        endTime,
        maxMint,
        pricePerToken,
        666,
        signature,
        { value: pricePerToken * 666n }
      );

      expect(await prophets.totalSupply()).to.equal(TOTAL);
      expect(await prophets.firstCycleStart()).to.be.gt(0);
      expect(await prophets.mintCompleteTimestamp()).to.be.gt(0);
    });
  });

  describe("Constructor & Configuration", () => {
    it("should set marketplace address correctly", async () => {
      expect(await prophets.marketplace()).to.equal(ethers.ZeroAddress);
    });

    it("should set default operator as allowed", async () => {
      const deployerAddress = await deployer.getAddress();
      expect(await prophets.allowedOperators(deployerAddress)).to.be.true;
    });
  });

  describe("Basic Functions", () => {
    it("should calculate minimal floor price correctly", async () => {
      // Before any cycles, floor price should be based on total supply
      const contractFloor = await prophets.getMinimalFloorPrice();
      const mintPrice = ethers.parseEther("0.01");
      
      // Floor price should be at least the mint price
      expect(contractFloor).to.be.gte(mintPrice);
    });


  });
});
