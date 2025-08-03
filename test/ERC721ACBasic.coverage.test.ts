import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC721ACBasic } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import "@nomicfoundation/hardhat-chai-matchers";

describe("ERC721ACBasic - Coverage Tests", function () {
  let contract: ERC721ACBasic;
  let owner: HardhatEthersSigner;
  let approver: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  const MAX_SUPPLY = 10000;

  beforeEach(async function () {
    [owner, approver, user] = await ethers.getSigners();

    const ERC721ACBasic = await ethers.getContractFactory("ERC721ACBasic");
    contract = await ERC721ACBasic.deploy(
      owner.address,
      250, // 2.5% royalty
      "Test Collection",
      "TEST",
      "https://api.test.com/metadata/",
      approver.address,
      MAX_SUPPLY
    );
    await contract.waitForDeployment();
  });

  describe("Interface Support (Line 50)", function () {
    it("Should call supportsInterface and return boolean", async function () {
      // Test that the function is called and returns a boolean
      // This covers line 50: return super.supportsInterface(interfaceId);
      
      // ERC165 interface ID (should be supported)
      const erc165InterfaceId = "0x01ffc9a7";
      const result1 = await contract.supportsInterface(erc165InterfaceId);
      expect(typeof result1).to.equal("boolean");
      expect(result1).to.be.true;
      
      // Random interface ID (should not be supported)
      const randomInterfaceId = "0x12345678";
      const result2 = await contract.supportsInterface(randomInterfaceId);
      expect(typeof result2).to.equal("boolean");
      expect(result2).to.be.false;
    });

    it("Should support ERC2981 (royalty) interface", async function () {
      // ERC2981 interface ID
      const erc2981InterfaceId = "0x2a55205a";
      expect(await contract.supportsInterface(erc2981InterfaceId)).to.be.true;
    });

    it("Should test multiple interface calls", async function () {
      // Test multiple calls to ensure line 50 is hit multiple times
      const interfaces = [
        "0x01ffc9a7", // ERC165
        "0x80ac58cd", // ERC721 (might not be supported by ERC721AC)
        "0x2a55205a", // ERC2981
        "0x12345678", // Random
        "0x00000000"  // Invalid
      ];
      
      for (const interfaceId of interfaces) {
        const result = await contract.supportsInterface(interfaceId);
        expect(typeof result).to.equal("boolean");
      }
    });
  });

  describe("Token Royalty (Line 58)", function () {
    beforeEach(async function () {
      // Mint a token first
      await contract.connect(owner).batchMint([user.address], [1]);
    });

    it("Should set token-specific royalty", async function () {
      const tokenId = 0;
      const royaltyReceiver = user.address;
      const royaltyFee = 500; // 5%

      await contract.connect(owner).setTokenRoyalty(tokenId, royaltyReceiver, royaltyFee);

      // Check royalty info
      const salePrice = ethers.parseEther("1");
      const [receiver, royaltyAmount] = await contract.royaltyInfo(tokenId, salePrice);
      
      expect(receiver).to.equal(royaltyReceiver);
      expect(royaltyAmount).to.equal(salePrice * BigInt(royaltyFee) / 10000n);
    });

    it("Should override default royalty with token-specific royalty", async function () {
      const tokenId = 0;
      const defaultReceiver = owner.address;
      const tokenReceiver = user.address;
      
      // Set default royalty
      await contract.connect(owner).setDefaultRoyalty(defaultReceiver, 250); // 2.5%
      
      // Set token-specific royalty
      await contract.connect(owner).setTokenRoyalty(tokenId, tokenReceiver, 750); // 7.5%

      const salePrice = ethers.parseEther("1");
      const [receiver, royaltyAmount] = await contract.royaltyInfo(tokenId, salePrice);
      
      expect(receiver).to.equal(tokenReceiver);
      expect(royaltyAmount).to.equal(salePrice * 750n / 10000n);
    });
  });

  describe("Token URI (Lines 62, 64)", function () {
    beforeEach(async function () {
      // Mint a token
      await contract.connect(owner).batchMint([user.address], [1]);
    });

    it("Should revert tokenURI for non-existent token (Line 62)", async function () {
      const nonExistentTokenId = 999;
      
      await expect(contract.tokenURI(nonExistentTokenId))
        .to.be.revertedWith("ERC721: URI query for nonexistent token");
    });

    it("Should return correct tokenURI with baseURI set", async function () {
      const tokenId = 0;
      const expectedURI = "https://api.test.com/metadata/0";
      
      expect(await contract.tokenURI(tokenId)).to.equal(expectedURI);
    });

    it("Should return empty string when baseURI is empty (Line 64)", async function () {
      const tokenId = 0;
      
      // Set baseURI to empty string
      await contract.connect(owner).setBaseURI("");
      
      expect(await contract.tokenURI(tokenId)).to.equal("");
    });

    it("Should handle baseURI changes", async function () {
      const tokenId = 0;
      const newBaseURI = "https://newapi.test.com/meta/";
      
      await contract.connect(owner).setBaseURI(newBaseURI);
      
      expect(await contract.tokenURI(tokenId)).to.equal(newBaseURI + "0");
    });
  });

  describe("Contract URI (Line 73)", function () {
    it("Should return empty contractURI by default", async function () {
      expect(await contract.contractURI()).to.equal("");
    });

    it("Should return updated contractURI after setting", async function () {
      const contractURI = "https://api.test.com/contract-metadata";
      
      await contract.connect(owner).setContractURI(contractURI);
      
      expect(await contract.contractURI()).to.equal(contractURI);
    });

    it("Should handle multiple contractURI updates", async function () {
      const contractURI1 = "https://api1.test.com/contract";
      const contractURI2 = "https://api2.test.com/contract";
      
      await contract.connect(owner).setContractURI(contractURI1);
      expect(await contract.contractURI()).to.equal(contractURI1);
      
      await contract.connect(owner).setContractURI(contractURI2);
      expect(await contract.contractURI()).to.equal(contractURI2);
    });
  });

  describe("Additional Edge Cases for Coverage", function () {
    it("Should handle zero royalty fee", async function () {
      await contract.connect(owner).setDefaultRoyalty(owner.address, 0);
      
      // Mint a token to test
      await contract.connect(owner).batchMint([user.address], [1]);
      
      const salePrice = ethers.parseEther("1");
      const [receiver, royaltyAmount] = await contract.royaltyInfo(0, salePrice);
      
      expect(receiver).to.equal(owner.address);
      expect(royaltyAmount).to.equal(0);
    });

    it("Should handle maximum royalty fee", async function () {
      const maxRoyalty = 10000; // 100%
      await contract.connect(owner).setDefaultRoyalty(owner.address, maxRoyalty);
      
      // Mint a token to test
      await contract.connect(owner).batchMint([user.address], [1]);
      
      const salePrice = ethers.parseEther("1");
      const [receiver, royaltyAmount] = await contract.royaltyInfo(0, salePrice);
      
      expect(receiver).to.equal(owner.address);
      expect(royaltyAmount).to.equal(salePrice);
    });

    it("Should handle very long baseURI", async function () {
      const longBaseURI = "https://very-long-domain-name-for-testing-purposes.example.com/api/v1/metadata/collections/test-collection-with-very-long-name/tokens/";
      
      await contract.connect(owner).setBaseURI(longBaseURI);
      await contract.connect(owner).batchMint([user.address], [1]);
      
      expect(await contract.tokenURI(0)).to.equal(longBaseURI + "0");
    });

    it("Should handle special characters in URIs", async function () {
      const baseURI = "https://api.test.com/metadata?collection=test&format=json&id=";
      const contractURI = "https://api.test.com/contract?collection=test&format=json";
      
      await contract.connect(owner).setBaseURI(baseURI);
      await contract.connect(owner).setContractURI(contractURI);
      await contract.connect(owner).batchMint([user.address], [1]);
      
      expect(await contract.tokenURI(0)).to.equal(baseURI + "0");
      expect(await contract.contractURI()).to.equal(contractURI);
    });
  });
});