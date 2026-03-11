import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";
import { getRichWallets } from "../utils/utils";

// Helper to increase time
async function increaseTime(seconds: number) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

describe("Staking Contract Tests", () => {
  let staking: any;
  let nft: any; // BasicERC721AC
  let deployer: any, user1: any, user2: any;

  beforeEach(async () => {
    const wallets = await getRichWallets();
    deployer = wallets[0];
    user1 = wallets[1];
    user2 = wallets[2];

    // Deploy BasicERC721ACUpgradeable as UUPS proxy
    const nftArtifact = await hre.artifacts.readArtifact("BasicERC721ACUpgradeable");
    const NftFactory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, deployer);
    const nftImpl = await NftFactory.deploy();
    await nftImpl.waitForDeployment();

    // Encode initialize call
    const initData = NftFactory.interface.encodeFunctionData("initialize", [
      await deployer.getAddress(), // royaltyReceiver
      500, // royaltyFee 5%
      "Test NFT", // name
      "TNFT", // symbol
      "" // baseURI
    ]);

    // Deploy ERC1967Proxy
    const proxyArtifact = await hre.artifacts.readArtifact("ERC1967Proxy");
    const ProxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, deployer);
    const proxy = await ProxyFactory.deploy(await nftImpl.getAddress(), initData);
    await proxy.waitForDeployment();

    // Attach BasicERC721AC ABI to proxy address
    nft = new ethers.Contract(await proxy.getAddress(), nftArtifact.abi, deployer);

    // Deploy Staking contract
    const stakingArtifact = await hre.artifacts.readArtifact("Staking");
    const StakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode, deployer);
    staking = await StakingFactory.deploy();
    await staking.waitForDeployment();

    // Whitelist the collection
    await staking.connect(deployer).setAllowedCollection(await nft.getAddress(), true);

    // Mint NFTs to user1 (IDs: 0,1,2,3,4)
    await nft.connect(deployer).batchMint([await user1.getAddress()], [5]);

    // Mint NFTs to user2 (IDs: 5,6)
    await nft.connect(deployer).batchMint([await user2.getAddress()], [2]);
  });

  describe("Deployment", () => {
    it("Should deploy correctly", async () => {
      expect(await staking.owner()).to.equal(await deployer.getAddress());
      expect(await staking.minStakeDuration()).to.equal(0);
    });

    it("Should have collection whitelisted", async () => {
      expect(await staking.allowedCollections(await nft.getAddress())).to.be.true;
    });
  });

  describe("Staking", () => {
    it("Should stake a single NFT", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      expect(await nft.ownerOf(0)).to.equal(stakingAddr);
      expect(await staking.isStaked(collectionAddr, 0)).to.be.true;
      expect(await staking.stakedCount(await user1.getAddress())).to.equal(1);

      const [stakerAddr, timestamp] = await staking.getStakeInfo(collectionAddr, 0);
      expect(stakerAddr).to.equal(await user1.getAddress());
      expect(timestamp).to.be.gt(0);
    });

    it("Should batch stake multiple NFTs", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).stake(collectionAddr, [0, 1, 2]);

      expect(await nft.ownerOf(0)).to.equal(stakingAddr);
      expect(await nft.ownerOf(1)).to.equal(stakingAddr);
      expect(await nft.ownerOf(2)).to.equal(stakingAddr);
      expect(await staking.stakedCount(await user1.getAddress())).to.equal(3);
    });

    it("Should reject staking from non-whitelisted collection", async () => {
      // Deploy a second collection as UUPS proxy (not whitelisted)
      const nftArtifact = await hre.artifacts.readArtifact("BasicERC721ACUpgradeable");
      const Factory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, deployer);
      const otherImpl = await Factory.deploy();
      await otherImpl.waitForDeployment();

      const initData = Factory.interface.encodeFunctionData("initialize", [
        await deployer.getAddress(), 500, "Other", "OTHER", ""
      ]);
      const proxyArtifact = await hre.artifacts.readArtifact("ERC1967Proxy");
      const ProxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, deployer);
      const otherProxy = await ProxyFactory.deploy(await otherImpl.getAddress(), initData);
      await otherProxy.waitForDeployment();

      const otherNft = new ethers.Contract(await otherProxy.getAddress(), nftArtifact.abi, deployer);
      await otherNft.connect(deployer).batchMint([await user1.getAddress()], [1]);
      await otherNft.connect(user1).approve(await staking.getAddress(), 0);

      await expect(
        staking.connect(user1).stake(await otherNft.getAddress(), [0])
      ).to.be.revertedWith("Collection not allowed");
    });

    it("Should reject staking with empty tokenIds array", async () => {
      await expect(
        staking.connect(user1).stake(await nft.getAddress(), [])
      ).to.be.revertedWith("No token IDs provided");
    });

    it("Should reject staking without approval", async () => {
      await expect(
        staking.connect(user1).stake(await nft.getAddress(), [0])
      ).to.be.reverted;
    });

    it("Should emit Staked events", async () => {
      const collectionAddr = await nft.getAddress();
      await nft.connect(user1).approve(await staking.getAddress(), 0);

      await expect(
        staking.connect(user1).stake(collectionAddr, [0])
      ).to.emit(staking, "Staked");
    });
  });

  describe("Unstaking", () => {
    beforeEach(async () => {
      const stakingAddr = await staking.getAddress();
      await nft.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).stake(await nft.getAddress(), [0, 1, 2]);
    });

    it("Should unstake a single NFT", async () => {
      const collectionAddr = await nft.getAddress();

      await staking.connect(user1).unstake(collectionAddr, [0]);

      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await staking.isStaked(collectionAddr, 0)).to.be.false;
      expect(await staking.stakedCount(await user1.getAddress())).to.equal(2);
    });

    it("Should batch unstake multiple NFTs", async () => {
      const collectionAddr = await nft.getAddress();

      await staking.connect(user1).unstake(collectionAddr, [0, 1, 2]);

      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(1)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(2)).to.equal(await user1.getAddress());
      expect(await staking.stakedCount(await user1.getAddress())).to.equal(0);
    });

    it("Should reject unstake by non-staker", async () => {
      await expect(
        staking.connect(user2).unstake(await nft.getAddress(), [0])
      ).to.be.revertedWith("Not staker");
    });

    it("Should reject unstake with empty tokenIds", async () => {
      await expect(
        staking.connect(user1).unstake(await nft.getAddress(), [])
      ).to.be.revertedWith("No token IDs provided");
    });

    it("Should emit Unstaked events", async () => {
      await expect(
        staking.connect(user1).unstake(await nft.getAddress(), [0])
      ).to.emit(staking, "Unstaked");
    });

    it("Should clear staking data after unstake", async () => {
      const collectionAddr = await nft.getAddress();
      await staking.connect(user1).unstake(collectionAddr, [0]);

      const [stakerAddr, timestamp] = await staking.getStakeInfo(collectionAddr, 0);
      expect(stakerAddr).to.equal(ethers.ZeroAddress);
      expect(timestamp).to.equal(0);
    });
  });

  describe("Min Stake Duration", () => {
    it("Should enforce minimum stake duration", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      // Set 1 hour min stake duration
      await staking.connect(deployer).setMinStakeDuration(3600);

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      // Try to unstake immediately — should fail
      await expect(
        staking.connect(user1).unstake(collectionAddr, [0])
      ).to.be.revertedWith("Min stake duration not met");

      // Advance time by 1 hour
      await increaseTime(3600);

      // Now unstake should work
      await staking.connect(user1).unstake(collectionAddr, [0]);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should allow immediate unstake when duration is 0", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      expect(await staking.minStakeDuration()).to.equal(0);

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);
      await staking.connect(user1).unstake(collectionAddr, [0]);

      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should emit MinStakeDurationUpdated event", async () => {
      await expect(
        staking.connect(deployer).setMinStakeDuration(7200)
      ).to.emit(staking, "MinStakeDurationUpdated")
        .withArgs(0, 7200);
    });

    it("Should reject setMinStakeDuration from non-owner", async () => {
      await expect(
        staking.connect(user1).setMinStakeDuration(3600)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Admin - Collection Management", () => {
    it("Should add and remove collections", async () => {
      const collectionAddr = await nft.getAddress();

      await staking.connect(deployer).setAllowedCollection(collectionAddr, false);
      expect(await staking.allowedCollections(collectionAddr)).to.be.false;

      await staking.connect(deployer).setAllowedCollection(collectionAddr, true);
      expect(await staking.allowedCollections(collectionAddr)).to.be.true;
    });

    it("Should reject zero address collection", async () => {
      await expect(
        staking.connect(deployer).setAllowedCollection(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Invalid collection");
    });

    it("Should reject setAllowedCollection from non-owner", async () => {
      await expect(
        staking.connect(user1).setAllowedCollection(await nft.getAddress(), false)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should emit CollectionUpdated event", async () => {
      const collectionAddr = await nft.getAddress();
      await expect(
        staking.connect(deployer).setAllowedCollection(collectionAddr, false)
      ).to.emit(staking, "CollectionUpdated")
        .withArgs(collectionAddr, false);
    });
  });

  describe("Rescue Functions", () => {
    it("Should rescue ETH", async () => {
      await deployer.sendTransaction({
        to: await staking.getAddress(),
        value: ethers.parseEther("1")
      });

      await expect(
        staking.connect(deployer).rescueETH(ethers.parseEther("0.5"))
      ).to.not.be.reverted;
    });

    it("Should rescue non-staked ERC721", async () => {
      // Mint directly to staking contract (not via stake)
      await nft.connect(deployer).batchMint([await staking.getAddress()], [1]);
      // This will be tokenId 7 (0-4 user1, 5-6 user2, 7 staking)

      await staking.connect(deployer).rescueERC721(await nft.getAddress(), 7);
      expect(await nft.ownerOf(7)).to.equal(await deployer.getAddress());
    });

    it("Should reject rescuing staked ERC721", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      await expect(
        staking.connect(deployer).rescueERC721(collectionAddr, 0)
      ).to.be.revertedWith("Token is staked");
    });

    it("Should rescue ERC20 tokens", async () => {
      // Deploy a test ERC20
      const erc20Artifact = await hre.artifacts.readArtifact("TestERC20");
      const ERC20Factory = new ethers.ContractFactory(erc20Artifact.abi, erc20Artifact.bytecode, deployer);
      const testToken = await ERC20Factory.deploy();
      await testToken.waitForDeployment();

      // Send tokens to staking contract
      const amount = ethers.parseEther("100");
      await testToken.connect(deployer).transfer(await staking.getAddress(), amount);
      expect(await testToken.balanceOf(await staking.getAddress())).to.equal(amount);

      // Rescue
      const ownerBefore = await testToken.balanceOf(await deployer.getAddress());
      await staking.connect(deployer).rescueERC20(await testToken.getAddress(), amount);
      const ownerAfter = await testToken.balanceOf(await deployer.getAddress());
      expect(ownerAfter - ownerBefore).to.equal(amount);
    });

    it("Should reject rescueERC20 from non-owner", async () => {
      const erc20Artifact = await hre.artifacts.readArtifact("TestERC20");
      const ERC20Factory = new ethers.ContractFactory(erc20Artifact.abi, erc20Artifact.bytecode, deployer);
      const testToken = await ERC20Factory.deploy();
      await testToken.waitForDeployment();

      await expect(
        staking.connect(user1).rescueERC20(await testToken.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should reject rescue from non-owner", async () => {
      await expect(
        staking.connect(user1).rescueETH(ethers.parseEther("0.1"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        staking.connect(user1).rescueERC721(await nft.getAddress(), 0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Multiple Users", () => {
    it("Should track staked counts per user independently", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).setApprovalForAll(stakingAddr, true);
      await nft.connect(user2).setApprovalForAll(stakingAddr, true);

      await staking.connect(user1).stake(collectionAddr, [0, 1]);
      await staking.connect(user2).stake(collectionAddr, [5]);

      expect(await staking.stakedCount(await user1.getAddress())).to.equal(2);
      expect(await staking.stakedCount(await user2.getAddress())).to.equal(1);

      await staking.connect(user1).unstake(collectionAddr, [0]);

      expect(await staking.stakedCount(await user1.getAddress())).to.equal(1);
      expect(await staking.stakedCount(await user2.getAddress())).to.equal(1);
    });
  });

  describe("AuthorizedMint", () => {
    it("Should allow authorizedMint from approved minter", async () => {
      await nft.connect(deployer).setAuthorizedMinter(await user2.getAddress(), true);

      // authorizedMint(to, tokenId, quantity) — tokenId ignored for ERC721A
      await nft.connect(user2).authorizedMint(await user2.getAddress(), 0, 2);

      // tokens 7 and 8 should belong to user2 (0-4 user1, 5-6 user2, 7-8 minted)
      expect(await nft.ownerOf(7)).to.equal(await user2.getAddress());
      expect(await nft.ownerOf(8)).to.equal(await user2.getAddress());
    });

    it("Should reject authorizedMint from non-minter", async () => {
      await expect(
        nft.connect(user1).authorizedMint(await user1.getAddress(), 0, 1)
      ).to.be.revertedWith("Not authorized minter");
    });

    it("Should emit AuthorizedMinterUpdated event", async () => {
      await expect(
        nft.connect(deployer).setAuthorizedMinter(await user2.getAddress(), true)
      ).to.emit(nft, "AuthorizedMinterUpdated")
        .withArgs(await user2.getAddress(), true);
    });

    it("Should reject setAuthorizedMinter from non-owner", async () => {
      await expect(
        nft.connect(user1).setAuthorizedMinter(await user1.getAddress(), true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
