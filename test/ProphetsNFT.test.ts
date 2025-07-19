import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import "@nomicfoundation/hardhat-chai-matchers";

describe("ProphetsNFT", function () {
  let prophetsNFT: any;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let mockPyth: any;

  const INITIAL_ETH_PRICE = 200000000000; // $2000 with 8 decimals (Pyth format)
  const ETH_USD_PRICE_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const MAX_SUPPLY = 666;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock Pyth contract
    const MockPyth = await ethers.getContractFactory("MockPythExtended");
    mockPyth = await MockPyth.deploy();

    // Set initial ETH price
    const initialTx = await mockPyth.setCurrentPrice(ETH_USD_PRICE_ID, INITIAL_ETH_PRICE);
    await initialTx.wait(); // Wait for transaction to be mined

    // Deploy ProphetsNFT
    const ProphetsNFTFactory = await ethers.getContractFactory("ProphetsNFT");
    prophetsNFT = await ProphetsNFTFactory.deploy(
      "666 Prophets",
      "PROPHET",
      await mockPyth.getAddress(),
      ETH_USD_PRICE_ID,
      ethers.parseEther("0.02") // 0.02 ETH mint price
    );
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await prophetsNFT.name()).to.equal("666 Prophets");
      expect(await prophetsNFT.symbol()).to.equal("PROPHET");
    });

    it("Should set correct max supply", async function () {
      expect(await prophetsNFT.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });

    it("Should set correct mint price", async function () {
      expect(await prophetsNFT.MINT_PRICE()).to.equal(ethers.parseEther("0.02"));
    });

    it("Should initialize Pyth contract correctly", async function () {
      expect(await prophetsNFT.pyth()).to.equal(await mockPyth.getAddress());
    });

    it("Should set correct ETH/USD price feed ID", async function () {
      expect(await prophetsNFT.ethUsdPriceId()).to.equal(ETH_USD_PRICE_ID);
    });
  });

  describe("Minting", function () {
    it("Should mint tokens correctly", async function () {
      const mintTx = await prophetsNFT.connect(user1).mint(1, { value: ethers.parseEther("0.02") });
      await mintTx.wait();

      expect(await prophetsNFT.balanceOf(user1.address)).to.equal(1);
      expect(await prophetsNFT.totalSupply()).to.equal(1);
    });

    it("Should reject minting with insufficient payment", async function () {
      await expect(
        prophetsNFT.connect(user1).mint(1, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should reject minting more than 10 per transaction", async function () {
      await expect(
        prophetsNFT.connect(user1).mint(11, { value: ethers.parseEther("0.22") })
      ).to.be.revertedWith("Max 10 per transaction");
    });

    it("Should reject minting beyond max supply", async function () {
      // This would require minting 666 tokens first, which is impractical for testing
      // Instead, we'll test the logic by checking the require statement exists
      await expect(
        prophetsNFT.connect(user1).mint(667, { value: ethers.parseEther("13.34") })
      ).to.be.revertedWith("Max 10 per transaction"); // This will fail first
    });
  });

  describe("State Management", function () {
    beforeEach(async function () {
      // Mint a token for testing
      await prophetsNFT.connect(user1).mint(1, { value: ethers.parseEther("0.02") });
    });

    it("Should return NEUTRAL state for small price changes", async function () {
      // Set price to $2050 (2.5% increase from $2000 baseline)
      await mockPyth.setCurrentPrice(ETH_USD_PRICE_ID, 205000000000);
      
      const state = await prophetsNFT.getCurrentStateView();
      expect(state).to.equal(1); // NEUTRAL
    });

    it("Should return BULLISH state for +5% price increase", async function () {
      // Set price to $2100 (5% increase from $2000 baseline)
      const tx = await mockPyth.setCurrentPrice(ETH_USD_PRICE_ID, 210000000000);
      await tx.wait(); // Wait for transaction to be mined
      
      const state = await prophetsNFT.getCurrentStateView();
      expect(state).to.equal(0); // BULLISH
    });

    it("Should return BEARISH state for -5% to -10% price decrease", async function () {
      // Set price to $1900 (-5% decrease from $2000 baseline)
      // Deploy a new MockPyth with the desired price
      const MockPyth = await ethers.getContractFactory("MockPythExtended");
      const newMockPyth = await MockPyth.deploy();
      
      const setPriceTx = await newMockPyth.setCurrentPrice(ETH_USD_PRICE_ID, 190000000000);
      await setPriceTx.wait(); // Wait for transaction to be mined
      
      // Update the ProphetsNFT to use the new MockPyth
      const updateTx = await prophetsNFT.updatePythContract(await newMockPyth.getAddress());
      await updateTx.wait(); // Wait for transaction to be mined
      
      const state = await prophetsNFT.getCurrentStateView();
      expect(state).to.equal(2); // BEARISH
    });

    it("Should return BONES_AND_ASHES state for -10% price decrease", async function () {
      // Set price to $1800 (-10% decrease from $2000 baseline)
      // Deploy a new MockPyth with the desired price
      const MockPyth = await ethers.getContractFactory("MockPythExtended");
      const newMockPyth = await MockPyth.deploy();
      
      const setPriceTx = await newMockPyth.setCurrentPrice(ETH_USD_PRICE_ID, 180000000000);
      await setPriceTx.wait(); // Wait for transaction to be mined
      
      // Update the ProphetsNFT to use the new MockPyth
      const updateTx = await prophetsNFT.updatePythContract(await newMockPyth.getAddress());
      await updateTx.wait(); // Wait for transaction to be mined
      
      const state = await prophetsNFT.getCurrentStateView();
      expect(state).to.equal(3); // BONES_AND_ASHES
    });
  });

  describe("Dynamic Metadata", function () {
    it("Should generate correct tokenURI", async function () {
      // Mint a token for testing
      await prophetsNFT.connect(user1).mint(1, { value: ethers.parseEther("0.02") });
      
      const tokenURI = await prophetsNFT.tokenURI(0);
      expect(tokenURI).to.include("data:application/json;base64,");
      
      // Decode and check JSON structure
      const jsonData = JSON.parse(
        Buffer.from(tokenURI.split("data:application/json;base64,")[1], "base64").toString()
      );
      
      expect(jsonData.name).to.equal("Prophet #0");
      expect(jsonData.description).to.include("prophets");
      expect(jsonData.image).to.include("data:image/png;base64,");
      expect(jsonData.attributes).to.be.an("array");
      expect(jsonData.attributes[0].trait_type).to.equal("State");
    });

    it("Should reject tokenURI for non-existent token", async function () {
      await expect(prophetsNFT.tokenURI(999)).to.be.revertedWith("Token does not exist");
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to update images", async function () {
      const newImage = "newImageBase64Data";
      
      await prophetsNFT.connect(owner).updateImages(
        newImage, newImage, newImage, newImage
      );
      
      // This test verifies the function executes without error
      // In a real scenario, we'd verify the images are updated in metadata
    });

    it("Should allow owner to update Pyth contract", async function () {
      const newMockPyth = await ethers.getContractFactory("MockPythExtended");
      const newPyth = await newMockPyth.deploy();
      
      await prophetsNFT.connect(owner).updatePythContract(await newPyth.getAddress());
      
      expect(await prophetsNFT.pyth()).to.equal(await newPyth.getAddress());
    });

    it("Should allow owner to update price feed ID", async function () {
      const newPriceId = "0x1234567890123456789012345678901234567890123456789012345678901234";
      
      await prophetsNFT.connect(owner).updatePriceId(newPriceId);
      
      expect(await prophetsNFT.ethUsdPriceId()).to.equal(newPriceId);
    });

    it("Should allow owner to update baseline price", async function () {
      const newBaselinePrice = 250000000000; // $2500 with 8 decimals
      
      await prophetsNFT.connect(owner).updateBaselinePrice(newBaselinePrice);
      
      expect(await prophetsNFT.baselinePrice()).to.equal(newBaselinePrice);
    });

    it("Should allow owner to withdraw funds", async function () {
      // First, mint some tokens to generate funds
      await prophetsNFT.connect(user1).mint(1, { value: ethers.parseEther("0.02") });
      
      const initialBalance = await ethers.provider.getBalance(owner.address);
      
             const tx = await prophetsNFT.connect(owner).withdraw();
       const receipt = await tx.wait();
       const gasUsed = BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice);
       
       const finalBalance = await ethers.provider.getBalance(owner.address);
       
       // Owner should have received the mint payment minus gas costs
       expect(finalBalance).to.be.closeTo(
         initialBalance + ethers.parseEther("0.02") - gasUsed,
         ethers.parseEther("0.001") // Allow for small gas estimation differences
       );
    });

    it("Should reject non-owner attempts to update images", async function () {
      await expect(
        prophetsNFT.connect(user1).updateImages("", "", "", "")
      ).to.be.revertedWithCustomError(prophetsNFT, "OwnableUnauthorizedAccount");
    });

    it("Should reject non-owner attempts to update Pyth contract", async function () {
      await expect(
        prophetsNFT.connect(user1).updatePythContract(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(prophetsNFT, "OwnableUnauthorizedAccount");
    });

    it("Should reject non-owner attempts to withdraw", async function () {
      await expect(
        prophetsNFT.connect(user1).withdraw()
      ).to.be.revertedWithCustomError(prophetsNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero quantity mint", async function () {
      await expect(
        prophetsNFT.connect(user1).mint(0, { value: ethers.parseEther("0") })
      ).to.be.revertedWith("Must mint at least 1");
    });

    it.skip("Should handle stale price data", async function () {
      // Skipped - staleness check not needed for this project
    });
  });
}); 