import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";

const TOTAL = 666n;
const MINT_PRICE = ethers.parseEther("0.01");

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

    // Deploy Prophets
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer);
    const baseURI = "ipfs://test/";
    const dummyPool = ethers.ZeroAddress;
    prophets = await Prophets.deploy(baseURI, dummyPool, await approver.getAddress());
    await prophets.waitForDeployment();

    // Configure to use MockPyth
    await prophets.setPythContract(await mockPyth.getAddress());
    await prophets.setPriceProvider(1); // PYTH = 1
  });

  describe("Signature-based Minting", () => {
    it("should mint with valid signature", async () => {
      const contractAddress = await prophets.getAddress();
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + 3600; // 1 hour from now
      const saleId = 1;
      const maxMint = 5;
      const pricePerToken = MINT_PRICE;
      const amount = 2;

      const signature = await createMintSignature(
        approver,
        contractAddress,
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
          signature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.not.be.reverted;

      expect(await prophets.totalSupply()).to.equal(amount);
      expect(await prophets.balanceOf(await user1.getAddress())).to.equal(amount);
    });

    it("should reject invalid signature", async () => {
      const contractAddress = await prophets.getAddress();
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + 3600;
      const saleId = 1;
      const maxMint = 5;
      const pricePerToken = MINT_PRICE;
      const amount = 2;

      // Create signature with wrong signer (user2 instead of approver)
      const invalidSignature = await createMintSignature(
        user2, // Wrong signer
        contractAddress,
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
      const endTime = currentTime + 3600;
      const saleId = 1;
      const maxMint = 3;
      const pricePerToken = MINT_PRICE;

      const signature = await createMintSignature(
        approver,
        contractAddress,
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
      const endTime = currentTime + 3600;
      const saleId = 1;
      const maxMint = 666;
      const pricePerToken = MINT_PRICE;

      const signature = await createMintSignature(
        approver,
        contractAddress,
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

  describe("Basic Functions", () => {
    it("should return correct alive prophets count", async () => {
      // Before any cycles, should return total supply
      // But we need to complete mint-out first
      const contractAddress = await prophets.getAddress();
      const currentTime = Math.floor(Date.now() / 1000);
      const endTime = currentTime + 3600;
      const saleId = 1;
      const maxMint = 666;
      const pricePerToken = MINT_PRICE;

      const signature = await createMintSignature(
        approver,
        contractAddress,
        await user1.getAddress(),
        saleId,
        endTime,
        maxMint,
        pricePerToken
      );

      // Complete mint-out
      await prophets.connect(user1).mint(
        saleId,
        endTime,
        maxMint,
        pricePerToken,
        666,
        signature,
        { value: pricePerToken * 666n }
      );

      // Now check alive count
      expect(await prophets.getAliveProphetsCount()).to.equal(TOTAL);
    });

    it("should calculate minimal floor price", async () => {
      const treasury = await prophets.getTreasury();
      const aliveProphets = await prophets.getAliveProphetsCount();
      const expectedFloor = aliveProphets > 0n ? treasury / aliveProphets : 0n;
      
      expect(await prophets.getMinimalFloorPrice()).to.equal(expectedFloor);
    });
  });
});
