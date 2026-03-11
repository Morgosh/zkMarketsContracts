import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";
import { getRichWallets } from "../utils/utils";

describe("MoodyArchives Tests", () => {
  let nft: any;
  let nftImpl: any;
  let proxy: any;
  let deployer: any, user1: any, user2: any;
  let nftArtifact: any;
  let NftFactory: any;

  // Helper to deploy a fresh proxy
  async function deployProxy() {
    nftArtifact = await hre.artifacts.readArtifact("MoodyArchives");
    NftFactory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, deployer);
    nftImpl = await NftFactory.deploy();
    await nftImpl.waitForDeployment();

    const initData = NftFactory.interface.encodeFunctionData("initialize", [
      await deployer.getAddress(), // royaltyReceiver
      500, // royaltyFee 5%
      "Test NFT", // name
      "TNFT", // symbol
      "https://api.test.com/metadata/" // baseURI
    ]);

    const proxyArtifact = await hre.artifacts.readArtifact("ERC1967Proxy");
    const ProxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, deployer);
    proxy = await ProxyFactory.deploy(await nftImpl.getAddress(), initData);
    await proxy.waitForDeployment();

    nft = new ethers.Contract(await proxy.getAddress(), nftArtifact.abi, deployer);
  }

  beforeEach(async () => {
    const wallets = await getRichWallets();
    deployer = wallets[0];
    user1 = wallets[1];
    user2 = wallets[2];

    await deployProxy();
  });

  // ============================================
  // Deployment & Initialization
  // ============================================
  describe("Deployment & Initialization", () => {
    it("Should initialize correctly", async () => {
      expect(await nft.name()).to.equal("Test NFT");
      expect(await nft.symbol()).to.equal("TNFT");
      expect(await nft.owner()).to.equal(await deployer.getAddress());
    });

    it("Should set initial royalty via initialize", async () => {
      // Mint a token so royaltyInfo has a valid reference
      await nft.connect(deployer).batchMint([await user1.getAddress()], [1]);
      const [receiver, amount] = await nft.royaltyInfo(0, ethers.parseEther("1"));
      expect(receiver).to.equal(await deployer.getAddress());
      // 5% of 1 ETH = 0.05 ETH
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("Should set initial baseURI via initialize", async () => {
      await nft.connect(deployer).batchMint([await user1.getAddress()], [1]);
      expect(await nft.tokenURI(0)).to.equal("https://api.test.com/metadata/0");
    });

    it("Should reject double initialization on proxy", async () => {
      await expect(
        nft.connect(deployer).initialize(
          await deployer.getAddress(),
          500,
          "Double Init",
          "DI",
          ""
        )
      ).to.be.reverted;
    });

    it("Should reject initialization on implementation (_disableInitializers)", async () => {
      const impl = new ethers.Contract(await nftImpl.getAddress(), nftArtifact.abi, deployer);
      await expect(
        impl.initialize(
          await deployer.getAddress(),
          500,
          "Impl Init",
          "II",
          ""
        )
      ).to.be.reverted;
    });
  });

  // ============================================
  // Minting
  // ============================================
  describe("Minting", () => {
    it("Should batchMint to single recipient", async () => {
      await nft.connect(deployer).batchMint([await user1.getAddress()], [3]);

      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(1)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(2)).to.equal(await user1.getAddress());
      expect(await nft.balanceOf(await user1.getAddress())).to.equal(3);
    });

    it("Should batchMint to multiple recipients", async () => {
      await nft.connect(deployer).batchMint(
        [await user1.getAddress(), await user2.getAddress()],
        [2, 3]
      );

      expect(await nft.balanceOf(await user1.getAddress())).to.equal(2);
      expect(await nft.balanceOf(await user2.getAddress())).to.equal(3);
      // user1 gets 0,1 — user2 gets 2,3,4
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(2)).to.equal(await user2.getAddress());
    });

    it("Should reject batchMint with array length mismatch", async () => {
      await expect(
        nft.connect(deployer).batchMint(
          [await user1.getAddress(), await user2.getAddress()],
          [3]
        )
      ).to.be.revertedWith("Arrays length mismatch");
    });

    it("Should reject batchMint with empty arrays", async () => {
      await expect(
        nft.connect(deployer).batchMint([], [])
      ).to.be.revertedWith("Empty arrays");
    });

    it("Should reject batchMint to zero address", async () => {
      await expect(
        nft.connect(deployer).batchMint([ethers.ZeroAddress], [1])
      ).to.be.revertedWith("Cannot mint to zero address");
    });

    it("Should reject batchMint with zero amount", async () => {
      await expect(
        nft.connect(deployer).batchMint([await user1.getAddress()], [0])
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should reject batchMint from non-owner", async () => {
      await expect(
        nft.connect(user1).batchMint([await user1.getAddress()], [1])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ============================================
  // Authorized Minting
  // ============================================
  describe("Authorized Minting", () => {
    it("Should allow authorizedMint from approved minter", async () => {
      await nft.connect(deployer).setAuthorizedMinter(await user2.getAddress(), true);
      // authorizedMint(to, tokenId, quantity) — tokenId ignored for ERC721A
      await nft.connect(user2).authorizedMint(await user1.getAddress(), 0, 3);

      expect(await nft.balanceOf(await user1.getAddress())).to.equal(3);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(1)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(2)).to.equal(await user1.getAddress());
    });

    it("Should reject authorizedMint from non-minter", async () => {
      await expect(
        nft.connect(user1).authorizedMint(await user1.getAddress(), 0, 1)
      ).to.be.revertedWith("Not authorized minter");
    });

    it("Should setAuthorizedMinter and revoke", async () => {
      await nft.connect(deployer).setAuthorizedMinter(await user1.getAddress(), true);
      expect(await nft.authorizedMinters(await user1.getAddress())).to.be.true;

      await nft.connect(deployer).setAuthorizedMinter(await user1.getAddress(), false);
      expect(await nft.authorizedMinters(await user1.getAddress())).to.be.false;

      await expect(
        nft.connect(user1).authorizedMint(await user1.getAddress(), 0, 1)
      ).to.be.revertedWith("Not authorized minter");
    });

    it("Should reject setAuthorizedMinter with zero address", async () => {
      await expect(
        nft.connect(deployer).setAuthorizedMinter(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Invalid minter");
    });

    it("Should reject setAuthorizedMinter from non-owner", async () => {
      await expect(
        nft.connect(user1).setAuthorizedMinter(await user1.getAddress(), true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should emit AuthorizedMinterUpdated event", async () => {
      await expect(
        nft.connect(deployer).setAuthorizedMinter(await user2.getAddress(), true)
      ).to.emit(nft, "AuthorizedMinterUpdated")
        .withArgs(await user2.getAddress(), true);
    });
  });

  // ============================================
  // Royalties (ERC2981)
  // ============================================
  describe("Royalties", () => {
    beforeEach(async () => {
      await nft.connect(deployer).batchMint([await user1.getAddress()], [5]);
    });

    it("Should return correct default royalty info", async () => {
      const salePrice = ethers.parseEther("10");
      const [receiver, royaltyAmount] = await nft.royaltyInfo(0, salePrice);
      expect(receiver).to.equal(await deployer.getAddress());
      expect(royaltyAmount).to.equal(ethers.parseEther("0.5")); // 5%
    });

    it("Should update default royalty with setDefaultRoyalty", async () => {
      await nft.connect(deployer).setDefaultRoyalty(await user2.getAddress(), 1000); // 10%
      const salePrice = ethers.parseEther("10");
      const [receiver, royaltyAmount] = await nft.royaltyInfo(0, salePrice);
      expect(receiver).to.equal(await user2.getAddress());
      expect(royaltyAmount).to.equal(ethers.parseEther("1")); // 10%
    });

    it("Should reject setDefaultRoyalty from non-owner", async () => {
      await expect(
        nft.connect(user1).setDefaultRoyalty(await user1.getAddress(), 1000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should set per-token royalty with setTokenRoyalty", async () => {
      await nft.connect(deployer).setTokenRoyalty(2, await user2.getAddress(), 2000); // 20% for token 2
      const salePrice = ethers.parseEther("10");

      // Token 2 should have custom royalty
      const [receiver2, amount2] = await nft.royaltyInfo(2, salePrice);
      expect(receiver2).to.equal(await user2.getAddress());
      expect(amount2).to.equal(ethers.parseEther("2")); // 20%

      // Token 0 should still have default
      const [receiver0, amount0] = await nft.royaltyInfo(0, salePrice);
      expect(receiver0).to.equal(await deployer.getAddress());
      expect(amount0).to.equal(ethers.parseEther("0.5")); // 5%
    });

    it("Should reject setTokenRoyalty from non-owner", async () => {
      await expect(
        nft.connect(user1).setTokenRoyalty(0, await user1.getAddress(), 1000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ============================================
  // Metadata
  // ============================================
  describe("Metadata", () => {
    beforeEach(async () => {
      await nft.connect(deployer).batchMint([await user1.getAddress()], [3]);
    });

    it("Should return correct tokenURI with baseURI", async () => {
      expect(await nft.tokenURI(0)).to.equal("https://api.test.com/metadata/0");
      expect(await nft.tokenURI(1)).to.equal("https://api.test.com/metadata/1");
      expect(await nft.tokenURI(2)).to.equal("https://api.test.com/metadata/2");
    });

    it("Should update tokenURI after setBaseURI", async () => {
      await nft.connect(deployer).setBaseURI("https://new-api.test.com/nft/");
      expect(await nft.tokenURI(0)).to.equal("https://new-api.test.com/nft/0");
    });

    it("Should reject setBaseURI from non-owner", async () => {
      await expect(
        nft.connect(user1).setBaseURI("https://evil.com/")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should return contractURI", async () => {
      expect(await nft.contractURI()).to.equal("");
    });

    it("Should update contractURI with setContractURI", async () => {
      await nft.connect(deployer).setContractURI("https://api.test.com/contract-meta");
      expect(await nft.contractURI()).to.equal("https://api.test.com/contract-meta");
    });

    it("Should reject setContractURI from non-owner", async () => {
      await expect(
        nft.connect(user1).setContractURI("https://evil.com/contract")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ============================================
  // ICreatorToken / Transfer Validation
  // ============================================
  describe("ICreatorToken / Transfer Validation", () => {
    let mockValidator: any;

    beforeEach(async () => {
      // Deploy mock validator
      const validatorArtifact = await hre.artifacts.readArtifact("MockTransferValidator");
      const ValidatorFactory = new ethers.ContractFactory(validatorArtifact.abi, validatorArtifact.bytecode, deployer);
      mockValidator = await ValidatorFactory.deploy();
      await mockValidator.waitForDeployment();

      // Mint some NFTs
      await nft.connect(deployer).batchMint([await user1.getAddress()], [5]);
    });

    it("Should return zero address for transfer validator by default", async () => {
      expect(await nft.getTransferValidator()).to.equal(ethers.ZeroAddress);
    });

    it("Should set transfer validator", async () => {
      await nft.connect(deployer).setTransferValidator(await mockValidator.getAddress());
      expect(await nft.getTransferValidator()).to.equal(await mockValidator.getAddress());
    });

    it("Should reject setTransferValidator from non-owner", async () => {
      await expect(
        nft.connect(user1).setTransferValidator(await mockValidator.getAddress())
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should emit TransferValidatorUpdated event", async () => {
      const validatorAddr = await mockValidator.getAddress();
      await expect(
        nft.connect(deployer).setTransferValidator(validatorAddr)
      ).to.emit(nft, "TransferValidatorUpdated")
        .withArgs(ethers.ZeroAddress, validatorAddr);
    });

    it("Should emit TransferValidatorUpdated with old and new on second update", async () => {
      const validatorAddr = await mockValidator.getAddress();
      await nft.connect(deployer).setTransferValidator(validatorAddr);

      await expect(
        nft.connect(deployer).setTransferValidator(ethers.ZeroAddress)
      ).to.emit(nft, "TransferValidatorUpdated")
        .withArgs(validatorAddr, ethers.ZeroAddress);
    });

    it("Should return correct transfer validation function", async () => {
      const [functionSignature, isViewFunction] = await nft.getTransferValidationFunction();
      const expected = ethers.id("validateTransfer(address,address,address,uint256)").slice(0, 10);
      expect(functionSignature).to.equal(expected);
      expect(isViewFunction).to.be.true;
    });

    it("Should allow transfers when no validator is set", async () => {
      await nft.connect(user1).transferFrom(await user1.getAddress(), await user2.getAddress(), 0);
      expect(await nft.ownerOf(0)).to.equal(await user2.getAddress());
    });

    it("Should allow transfers when validator approves", async () => {
      await nft.connect(deployer).setTransferValidator(await mockValidator.getAddress());
      // shouldBlock is false by default
      await nft.connect(user1).transferFrom(await user1.getAddress(), await user2.getAddress(), 0);
      expect(await nft.ownerOf(0)).to.equal(await user2.getAddress());
    });

    it("Should block transfers when validator rejects", async () => {
      await nft.connect(deployer).setTransferValidator(await mockValidator.getAddress());
      await mockValidator.setBlockAll(true);

      await expect(
        nft.connect(user1).transferFrom(await user1.getAddress(), await user2.getAddress(), 0)
      ).to.be.revertedWith("Transfer blocked by validator");
    });

    it("Should not validate on minting (from == address(0))", async () => {
      await nft.connect(deployer).setTransferValidator(await mockValidator.getAddress());
      await mockValidator.setBlockAll(true);

      // Minting should still work even if validator blocks transfers
      await expect(
        nft.connect(deployer).batchMint([await user2.getAddress()], [1])
      ).to.not.be.reverted;
    });

    it("Should validate each token in a batch transfer", async () => {
      await nft.connect(deployer).setTransferValidator(await mockValidator.getAddress());

      // Approve and transfer one token to confirm it works
      await nft.connect(user1).transferFrom(await user1.getAddress(), await user2.getAddress(), 0);
      expect(await nft.ownerOf(0)).to.equal(await user2.getAddress());

      // Now block and try another
      await mockValidator.setBlockAll(true);
      await expect(
        nft.connect(user1).transferFrom(await user1.getAddress(), await user2.getAddress(), 1)
      ).to.be.revertedWith("Transfer blocked by validator");
    });
  });

  // ============================================
  // supportsInterface
  // ============================================
  describe("supportsInterface", () => {
    it("Should support ERC721 interface", async () => {
      // ERC721 interfaceId = 0x80ac58cd
      expect(await nft.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("Should support ERC2981 interface", async () => {
      // ERC2981 interfaceId = 0x2a55205a
      expect(await nft.supportsInterface("0x2a55205a")).to.be.true;
    });

    it("Should support ERC165 interface", async () => {
      // ERC165 interfaceId = 0x01ffc9a7
      expect(await nft.supportsInterface("0x01ffc9a7")).to.be.true;
    });

    it("Should support ICreatorToken interface", async () => {
      // ICreatorToken has: getTransferValidator(), setTransferValidator(address), getTransferValidationFunction()
      // Plus the TransferValidatorUpdated event but events don't count for interfaceId
      const iface = new ethers.Interface([
        "function getTransferValidator() view returns (address)",
        "function setTransferValidator(address)",
        "function getTransferValidationFunction() view returns (bytes4, bool)"
      ]);

      // Calculate interface ID by XORing function selectors
      const selectors = [
        iface.getFunction("getTransferValidator")!.selector,
        iface.getFunction("setTransferValidator")!.selector,
        iface.getFunction("getTransferValidationFunction")!.selector,
      ];

      let interfaceId = 0n;
      for (const sel of selectors) {
        interfaceId ^= BigInt(sel);
      }
      const interfaceIdHex = "0x" + interfaceId.toString(16).padStart(8, "0");

      expect(await nft.supportsInterface(interfaceIdHex)).to.be.true;
    });

    it("Should not support random interface", async () => {
      expect(await nft.supportsInterface("0xdeadbeef")).to.be.false;
    });
  });

  // ============================================
  // UUPS Upgrade
  // ============================================
  describe("UUPS Upgrade", () => {
    it("Should allow owner to upgrade", async () => {
      // Deploy a new implementation
      const newImpl = await NftFactory.deploy();
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();

      // upgradeTo should succeed
      await expect(
        nft.connect(deployer).upgradeTo(newImplAddr)
      ).to.not.be.reverted;

      // Contract should still work after upgrade
      await nft.connect(deployer).batchMint([await user1.getAddress()], [1]);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should reject upgrade from non-owner", async () => {
      const newImpl = await NftFactory.deploy();
      await newImpl.waitForDeployment();

      await expect(
        nft.connect(user1).upgradeTo(await newImpl.getAddress())
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should preserve state after upgrade", async () => {
      // Mint some tokens first
      await nft.connect(deployer).batchMint([await user1.getAddress()], [3]);
      await nft.connect(deployer).setBaseURI("https://before-upgrade.com/");
      await nft.connect(deployer).setContractURI("https://contract-before.com");

      expect(await nft.balanceOf(await user1.getAddress())).to.equal(3);

      // Deploy and upgrade
      const newImpl = await NftFactory.deploy();
      await newImpl.waitForDeployment();
      await nft.connect(deployer).upgradeTo(await newImpl.getAddress());

      // All state should be preserved
      expect(await nft.name()).to.equal("Test NFT");
      expect(await nft.symbol()).to.equal("TNFT");
      expect(await nft.owner()).to.equal(await deployer.getAddress());
      expect(await nft.balanceOf(await user1.getAddress())).to.equal(3);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await nft.tokenURI(0)).to.equal("https://before-upgrade.com/0");
      expect(await nft.contractURI()).to.equal("https://contract-before.com");
    });
  });

  // ============================================
  // Withdrawals
  // ============================================
  describe("Withdrawals", () => {
    let testERC20: any;

    beforeEach(async () => {
      // Deploy TestERC20
      const erc20Artifact = await hre.artifacts.readArtifact("TestERC20");
      const ERC20Factory = new ethers.ContractFactory(erc20Artifact.abi, erc20Artifact.bytecode, deployer);
      testERC20 = await ERC20Factory.deploy();
      await testERC20.waitForDeployment();
    });

    describe("withdraw (ETH)", () => {
      it("Should accept ETH via receive()", async () => {
        await expect(
          deployer.sendTransaction({
            to: await nft.getAddress(),
            value: ethers.parseEther("1")
          })
        ).to.not.be.reverted;
      });

      it("Should withdraw ETH to owner", async () => {
        await deployer.sendTransaction({
          to: await nft.getAddress(),
          value: ethers.parseEther("2")
        });

        const ownerBalanceBefore = await hre.ethers.provider.getBalance(await deployer.getAddress());
        await nft.connect(deployer).withdraw();
        const ownerBalanceAfter = await hre.ethers.provider.getBalance(await deployer.getAddress());

        // Owner should have more ETH (minus gas)
        expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
      });

      it("Should reject withdraw with no ETH", async () => {
        await expect(
          nft.connect(deployer).withdraw()
        ).to.be.revertedWith("No ETH to withdraw");
      });

      it("Should reject withdraw from non-owner", async () => {
        await expect(
          nft.connect(user1).withdraw()
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });

    describe("withdrawERC20", () => {
      it("Should withdraw ERC20 tokens to owner", async () => {
        const amount = ethers.parseEther("500");
        await testERC20.connect(deployer).transfer(await nft.getAddress(), amount);

        const ownerBefore = await testERC20.balanceOf(await deployer.getAddress());
        await nft.connect(deployer).withdrawERC20(await testERC20.getAddress());
        const ownerAfter = await testERC20.balanceOf(await deployer.getAddress());

        expect(ownerAfter - ownerBefore).to.equal(amount);
      });

      it("Should reject withdrawERC20 with zero address", async () => {
        await expect(
          nft.connect(deployer).withdrawERC20(ethers.ZeroAddress)
        ).to.be.revertedWith("Invalid token address");
      });

      it("Should reject withdrawERC20 with no balance", async () => {
        await expect(
          nft.connect(deployer).withdrawERC20(await testERC20.getAddress())
        ).to.be.revertedWith("No tokens to withdraw");
      });

      it("Should reject withdrawERC20 from non-owner", async () => {
        await expect(
          nft.connect(user1).withdrawERC20(await testERC20.getAddress())
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });

    describe("withdrawERC721", () => {
      it("Should withdraw ERC721 to owner", async () => {
        // Mint an NFT directly to the contract
        await nft.connect(deployer).batchMint([await nft.getAddress()], [1]);
        // tokenId 0 now belongs to the NFT contract itself

        await nft.connect(deployer).withdrawERC721(await nft.getAddress(), 0);
        expect(await nft.ownerOf(0)).to.equal(await deployer.getAddress());
      });

      it("Should reject withdrawERC721 with zero address", async () => {
        await expect(
          nft.connect(deployer).withdrawERC721(ethers.ZeroAddress, 0)
        ).to.be.revertedWith("Invalid token address");
      });

      it("Should reject withdrawERC721 from non-owner", async () => {
        await expect(
          nft.connect(user1).withdrawERC721(await nft.getAddress(), 0)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });
  });

  // ============================================
  // ERC721 Standard Operations
  // ============================================
  describe("ERC721 Standard Operations", () => {
    beforeEach(async () => {
      await nft.connect(deployer).batchMint([await user1.getAddress()], [5]);
    });

    it("Should transfer via transferFrom", async () => {
      await nft.connect(user1).transferFrom(await user1.getAddress(), await user2.getAddress(), 0);
      expect(await nft.ownerOf(0)).to.equal(await user2.getAddress());
    });

    it("Should approve and transferFrom", async () => {
      await nft.connect(user1).approve(await user2.getAddress(), 1);
      await nft.connect(user2).transferFrom(await user1.getAddress(), await user2.getAddress(), 1);
      expect(await nft.ownerOf(1)).to.equal(await user2.getAddress());
    });

    it("Should setApprovalForAll and transferFrom", async () => {
      await nft.connect(user1).setApprovalForAll(await user2.getAddress(), true);
      await nft.connect(user2).transferFrom(await user1.getAddress(), await user2.getAddress(), 0);
      await nft.connect(user2).transferFrom(await user1.getAddress(), await user2.getAddress(), 1);
      expect(await nft.ownerOf(0)).to.equal(await user2.getAddress());
      expect(await nft.ownerOf(1)).to.equal(await user2.getAddress());
    });

    it("Should return correct balanceOf", async () => {
      expect(await nft.balanceOf(await user1.getAddress())).to.equal(5);
      expect(await nft.balanceOf(await user2.getAddress())).to.equal(0);
    });

    it("Should return correct totalSupply", async () => {
      expect(await nft.totalSupply()).to.equal(5);
      await nft.connect(deployer).batchMint([await user2.getAddress()], [3]);
      expect(await nft.totalSupply()).to.equal(8);
    });
  });
});
