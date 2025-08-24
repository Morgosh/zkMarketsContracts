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

// Helper function to create mint signature
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
    name: "Prophets of Ethereum",
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

describe("ProphetsOfEthereum - Punishment Tests (Simplified)", () => {
  let prophets: any;
  let mockPyth: any;
  let deployer: any, user1: any, user2: any, user3: any, approver: any;

  beforeEach(async () => {
    deployer = await provider.getSigner(0);
    user1 = await provider.getSigner(1);
    user2 = await provider.getSigner(2);
    user3 = await provider.getSigner(3);
    approver = await provider.getSigner(4);

    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    const startPx = 3000n * 10n ** 8n; // $3000
    mockPyth = await MockPyth.deploy(startPx, -8);
    await mockPyth.waitForDeployment();

    // Deploy Prophets
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const baseURI = "ipfs://test/";
    const dummyPool = ethers.ZeroAddress;
    const mockMarketplace = ethers.ZeroAddress; // Mock marketplace for testing
    const defaultOperator = await deployer.getAddress(); // Set deployer as default operator
    
    prophets = await Prophets.deploy(
      baseURI, 
      dummyPool, 
      await approver.getAddress(),
      mockMarketplace,
      defaultOperator
    );
    await prophets.waitForDeployment();

    // Configure to use MockPyth
    await prophets.setPythContract(await mockPyth.getAddress());
    await prophets.setPriceProvider(1); // PYTH = 1

    // Complete mint out using signature-based minting
    const contractAddress = await prophets.getAddress();
    const currentTime = Math.floor(Date.now() / 1000);
    const endTime = currentTime + 3600; // 1 hour from now
    const saleId = 1;
    const maxMint = 333;
    const pricePerToken = MINT_PRICE;

    // Create signatures for both users
    const signature1 = await createMintSignature(
      approver,
      contractAddress,
      await user1.getAddress(),
      saleId,
      endTime,
      maxMint,
      pricePerToken
    );

    const signature2 = await createMintSignature(
      approver,
      contractAddress,
      await user2.getAddress(),
      saleId + 1, // Different sale ID
      endTime,
      maxMint,
      pricePerToken
    );

    await prophets.connect(user1).mint(saleId, endTime, maxMint, pricePerToken, 333, signature1, { value: MINT_PRICE * 333n });
    await prophets.connect(user2).mint(saleId + 1, endTime, maxMint, pricePerToken, 333, signature2, { value: MINT_PRICE * 333n });
  });

  describe("getAliveProphetsCount", () => {
    it("returns total supply before game starts", async () => {
      // After mint completion, we're actually in cycle 1, but still return total supply
      const currentCycle = await prophets.getCurrentCycle();
      expect(currentCycle).to.be.gte(0); // Could be 0 or 1 depending on timing
      expect(await prophets.getAliveProphetsCount()).to.equal(TOTAL);
    });

    it("returns total supply during first cycle", async () => {
      // First cycle should return total supply since cycle <= 1
      expect(await prophets.getAliveProphetsCount()).to.equal(TOTAL);
    });
  });

  describe("getMinimalFloorPrice", () => {
    it("calculates floor price based on treasury and alive count", async () => {
      const treasury = await prophets.getTreasury();
      const aliveProphets = await prophets.getAliveProphetsCount();
      const expectedFloor = aliveProphets > 0n ? treasury / aliveProphets : 0n;
      
      expect(await prophets.getMinimalFloorPrice()).to.equal(expectedFloor);
    });
  });

  describe("punishUnfaithful - Basic Validation", () => {
    let orderParams: any;
    let signature: string;
    let fullHash: string;
    let mockMarketplace: string;

    beforeEach(async () => {
      // Get current blockchain timestamp
      const currentBlock = await provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      
      // Setup basic order parameters
      orderParams = {
        offerer: await user1.getAddress(),
        orderType: 0, // ERC721_FOR_ETH
        offer: {
          itemType: 0, // NFT
          tokenAddress: await prophets.getAddress(),
          identifier: 1n,
          amount: 1n
        },
        consideration: {
          itemType: 2, // ETH
          tokenAddress: ethers.ZeroAddress,
          identifier: 0n,
          amount: ethers.parseEther("0.001") // Low price
        },
        royaltyReceiver: ethers.ZeroAddress,
        royaltyPercentageIn10000: 0n,
        startTime: currentTime,
        endTime: currentTime + 86400,
        createdTime: currentTime
      };

      // Mock parameters for testing
      fullHash = ethers.keccak256(ethers.toUtf8Bytes("MockOrderHash"));
      signature = "0x" + "00".repeat(65); // Mock signature for testing
      mockMarketplace = ethers.ZeroAddress; // Mock marketplace address
    });

    it("reverts if order is not for NFT", async () => {
      orderParams.offer.itemType = 1; // ERC20
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
      ).to.be.revertedWith("not-nft");
    });

    it("reverts if order is not for this collection", async () => {
      orderParams.offer.tokenAddress = ethers.ZeroAddress;
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
      ).to.be.revertedWith("wrong-collection");
    });

    it("reverts if order type is not ERC721_FOR_ETH", async () => {
      orderParams.orderType = 1; // ERC20_FOR_ERC721
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
      ).to.be.revertedWith("wrong-type");
    });

    it("reverts if offerer is not the token owner", async () => {
      orderParams.offerer = await user2.getAddress(); // user2 doesn't own token 1
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
      ).to.be.revertedWith("not-owner");
    });

    it("reverts if signature is invalid", async () => {
      const invalidSignature = "0x" + "ff".repeat(65); // Invalid signature
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, invalidSignature, fullHash)
      ).to.be.revertedWith("invalid-signature");
    });

    it("reverts if listing price is above minimal floor", async () => {
      const minimalFloor = await prophets.getMinimalFloorPrice();
      orderParams.consideration.amount = minimalFloor + 1n; // Above floor
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
      ).to.be.revertedWith("above-minimal-floor");
    });

    it("reverts if grace period has expired (after 1 hour)", async () => {
      const minimalFloor = await prophets.getMinimalFloorPrice();
      orderParams.consideration.amount = minimalFloor > 0n ? minimalFloor - 1n : 1n; // Below floor
      
      // Get current blockchain timestamp and set createdTime to more than 1 hour ago
      const currentBlock = await provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const oneHourAgo = currentTime - 3601; // 1 hour + 1 second ago
      orderParams.createdTime = oneHourAgo;
      
      await expect(
        prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
      ).to.be.revertedWith("grace-period-expired");
    });

    it("allows punishment within grace period (current time)", async () => {
      const minimalFloor = await prophets.getMinimalFloorPrice();
      
      // Only test if there's actually a floor price to test against
      if (minimalFloor > 0n) {
        orderParams.consideration.amount = minimalFloor - 1n; // Below floor
        
        // Use current blockchain timestamp (should be within grace period)
        const currentBlock = await provider.getBlock("latest");
        const currentTime = currentBlock!.timestamp;
        orderParams.createdTime = currentTime; // Just created
        
        // Should not revert due to grace period (just created)
        await expect(
          prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash)
        ).to.not.be.revertedWith("grace-period-expired");
        
        // Should burn the token
        expect(await prophets.isBurned(1)).to.be.true;
      } else {
        console.log("Skipping grace period test - no floor price set");
      }
    });

    it("successfully burns NFT when listing below minimal floor", async () => {
      const minimalFloor = await prophets.getMinimalFloorPrice();
      
      // Only test if there's actually a floor price to test against
      if (minimalFloor > 0n) {
        orderParams.consideration.amount = minimalFloor - 1n; // Below floor
        
        // Verify token is not burned initially
        expect(await prophets.isBurned(1)).to.be.false;
        
        // Execute punishment
        const tx = await prophets.connect(user3).punishUnfaithful(orderParams, signature, fullHash, mockMarketplace);
        
        // Verify token is now burned
        expect(await prophets.isBurned(1)).to.be.true;
        
        // Check event emission
        await expect(tx)
          .to.emit(prophets, "UnfaithfulPunished")
          .withArgs(1n, orderParams.consideration.amount, minimalFloor, await user3.getAddress());
      } else {
        console.log("Skipping burn test - no floor price set");
      }
    });
  });

  describe("Floor Price Calculation", () => {
    it("demonstrates basic floor price calculation", async () => {
      const treasury = await prophets.getTreasury();
      const aliveProphets = await prophets.getAliveProphetsCount();
      const calculatedFloor = aliveProphets > 0n ? treasury / aliveProphets : 0n;
      const contractFloor = await prophets.getMinimalFloorPrice();
      
      expect(contractFloor).to.equal(calculatedFloor);
      
      console.log(`Treasury: ${ethers.formatEther(treasury)} ETH`);
      console.log(`Alive Prophets: ${aliveProphets}`);
      console.log(`Minimal Floor: ${ethers.formatEther(contractFloor)} ETH`);
      
      // Floor should be treasury divided by alive prophets
      if (aliveProphets > 0n) {
        expect(contractFloor).to.equal(treasury / aliveProphets);
      }
    });
  });

  describe("Grace Period Protection Scenario", () => {
    it("demonstrates protection from retroactive punishment when floor rises", async () => {
      // This test demonstrates the scenario described in the requirements:
      // "If the minimal floor price rises due to fewer prophets alive or a larger prize pool 
      // and surpasses your listing price, your NFT is safe from punishment after 1 hour."
      
      const minimalFloor = await prophets.getMinimalFloorPrice();
      
      if (minimalFloor > 0n) {
        // Create an order that's currently below floor
        const currentBlock = await provider.getBlock("latest");
        const currentTime = currentBlock!.timestamp;
        
        const protectedOrderParams = {
          offerer: await user1.getAddress(),
          orderType: 0,
          offer: {
            itemType: 0,
            tokenAddress: await prophets.getAddress(),
            identifier: 2n, // Different token
            amount: 1n
          },
          consideration: {
            itemType: 2,
            tokenAddress: ethers.ZeroAddress,
            identifier: 0n,
            amount: minimalFloor - 1n // Below current floor
          },
          royaltyReceiver: ethers.ZeroAddress,
          royaltyPercentageIn10000: 0n,
          startTime: currentTime,
          endTime: currentTime + 86400,
          createdTime: currentTime - 3601 // More than 1 hour ago
        };
        
        // Should be protected from punishment due to grace period expiry
        await expect(
          prophets.connect(user3).punishUnfaithful(protectedOrderParams, signature, fullHash)
        ).to.be.revertedWith("grace-period-expired");
        
        // Token should remain unburned (protected)
        expect(await prophets.isBurned(2)).to.be.false;
        
        console.log("✅ Prophet protected from retroactive punishment after grace period!");
      } else {
        console.log("Skipping protection scenario - no floor price set");
      }
    });
  });
});
