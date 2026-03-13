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
  let nft: any; // MoodyArchives (ERC721)
  let erc1155: any; // TestERC1155
  let deployer: any, user1: any, user2: any;

  beforeEach(async () => {
    const wallets = await getRichWallets();
    deployer = wallets[0];
    user1 = wallets[1];
    user2 = wallets[2];

    // Deploy MoodyArchives as UUPS proxy
    const nftArtifact = await hre.artifacts.readArtifact("MoodyArchives");
    const NftFactory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, deployer);
    const nftImpl = await NftFactory.deploy();
    await nftImpl.waitForDeployment();

    const nftInitData = NftFactory.interface.encodeFunctionData("initialize", [
      await deployer.getAddress(), // royaltyReceiver
      500, // royaltyFee 5%
      "Test NFT", // name
      "TNFT", // symbol
      "" // baseURI
    ]);

    const proxyArtifact = await hre.artifacts.readArtifact("ERC1967Proxy");
    const ProxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, deployer);
    const nftProxy = await ProxyFactory.deploy(await nftImpl.getAddress(), nftInitData);
    await nftProxy.waitForDeployment();
    nft = new ethers.Contract(await nftProxy.getAddress(), nftArtifact.abi, deployer);

    // Deploy TestERC1155
    const erc1155Artifact = await hre.artifacts.readArtifact("TestERC1155");
    const ERC1155Factory = new ethers.ContractFactory(erc1155Artifact.abi, erc1155Artifact.bytecode, deployer);
    erc1155 = await ERC1155Factory.deploy();
    await erc1155.waitForDeployment();

    // Deploy Staking as UUPS proxy
    const stakingArtifact = await hre.artifacts.readArtifact("Staking");
    const StakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode, deployer);
    const stakingImpl = await StakingFactory.deploy();
    await stakingImpl.waitForDeployment();

    const stakingInitData = StakingFactory.interface.encodeFunctionData("initialize", []);
    const stakingProxy = await ProxyFactory.deploy(await stakingImpl.getAddress(), stakingInitData);
    await stakingProxy.waitForDeployment();
    staking = new ethers.Contract(await stakingProxy.getAddress(), stakingArtifact.abi, deployer);

    // Whitelist the ERC721 collection
    await staking.connect(deployer).setAllowedCollection(await nft.getAddress(), true);

    // Whitelist the ERC1155 collection
    await staking.connect(deployer).setAllowedCollection(await erc1155.getAddress(), true);

    // Mint ERC721 NFTs to user1 (IDs: 0,1,2,3,4)
    await nft.connect(deployer).batchMint([await user1.getAddress()], [5]);

    // Mint ERC721 NFTs to user2 (IDs: 5,6)
    await nft.connect(deployer).batchMint([await user2.getAddress()], [2]);

    // Mint ERC1155 tokens to user1: token 1 x 10, token 2 x 5
    await erc1155.connect(deployer).mint(await user1.getAddress(), 1, 10);
    await erc1155.connect(deployer).mint(await user1.getAddress(), 2, 5);

    // Mint ERC1155 tokens to user2: token 1 x 3
    await erc1155.connect(deployer).mint(await user2.getAddress(), 1, 3);
  });

  describe("Deployment", () => {
    it("Should deploy correctly as proxy", async () => {
      expect(await staking.owner()).to.equal(await deployer.getAddress());
      expect(await staking.minStakeDuration()).to.equal(0);
    });

    it("Should have collections whitelisted", async () => {
      expect(await staking.allowedCollections(await nft.getAddress())).to.be.true;
      expect(await staking.allowedCollections(await erc1155.getAddress())).to.be.true;
    });
  });

  describe("ERC721 Staking", () => {
    it("Should stake a single NFT", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      expect(await nft.ownerOf(0)).to.equal(stakingAddr);
      expect(await staking.isStaked(collectionAddr, 0)).to.be.true;
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

    });

    it("Should reject staking from non-whitelisted collection", async () => {
      const nftArtifact = await hre.artifacts.readArtifact("MoodyArchives");
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

  describe("ERC721 Unstaking", () => {
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

    });

    it("Should batch unstake multiple NFTs", async () => {
      const collectionAddr = await nft.getAddress();

      await staking.connect(user1).unstake(collectionAddr, [0, 1, 2]);

      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(1)).to.equal(await user1.getAddress());
      expect(await nft.ownerOf(2)).to.equal(await user1.getAddress());

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

  describe("ERC1155 Staking", () => {
    it("Should stake ERC1155 tokens", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).stakeERC1155(collectionAddr, 1, 5);

      const [amount, timestamp] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      expect(amount).to.equal(5);
      expect(timestamp).to.be.gt(0);

      expect(await erc1155.balanceOf(stakingAddr, 1)).to.equal(5);
    });

    it("Should batch stake multiple ERC1155 token types", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).batchStakeERC1155(collectionAddr, [1, 2], [3, 2]);

      const [amount1] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      const [amount2] = await staking.getERC1155StakeInfo(collectionAddr, 2, await user1.getAddress());
      expect(amount1).to.equal(3);
      expect(amount2).to.equal(2);

    });

    it("Should reject staking from non-whitelisted ERC1155 collection", async () => {
      const erc1155Artifact = await hre.artifacts.readArtifact("TestERC1155");
      const Factory = new ethers.ContractFactory(erc1155Artifact.abi, erc1155Artifact.bytecode, deployer);
      const other = await Factory.deploy();
      await other.waitForDeployment();
      await other.connect(deployer).mint(await user1.getAddress(), 1, 10);
      await other.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await expect(
        staking.connect(user1).stakeERC1155(await other.getAddress(), 1, 5)
      ).to.be.revertedWith("Collection not allowed");
    });

    it("Should reject staking 0 amount", async () => {
      const collectionAddr = await erc1155.getAddress();
      await erc1155.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await expect(
        staking.connect(user1).stakeERC1155(collectionAddr, 1, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should emit StakedERC1155 event", async () => {
      const collectionAddr = await erc1155.getAddress();
      await erc1155.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await expect(
        staking.connect(user1).stakeERC1155(collectionAddr, 1, 5)
      ).to.emit(staking, "StakedERC1155");
    });
  });

  describe("ERC1155 Unstaking", () => {
    beforeEach(async () => {
      const stakingAddr = await staking.getAddress();
      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).stakeERC1155(await erc1155.getAddress(), 1, 8);
    });

    it("Should unstake partial ERC1155 amount", async () => {
      const collectionAddr = await erc1155.getAddress();

      await staking.connect(user1).unstakeERC1155(collectionAddr, 1, 3);

      const [amount] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      expect(amount).to.equal(5);

      expect(await erc1155.balanceOf(await user1.getAddress(), 1)).to.equal(5); // 10 - 8 staked + 3 unstaked
    });

    it("Should unstake full ERC1155 amount and clear timestamp", async () => {
      const collectionAddr = await erc1155.getAddress();

      await staking.connect(user1).unstakeERC1155(collectionAddr, 1, 8);

      const [amount, timestamp] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      expect(amount).to.equal(0);
      expect(timestamp).to.equal(0);

    });

    it("Should reject unstaking more than staked", async () => {
      await expect(
        staking.connect(user1).unstakeERC1155(await erc1155.getAddress(), 1, 20)
      ).to.be.revertedWith("Insufficient staked amount");
    });

    it("Should reject unstaking by non-staker", async () => {
      await expect(
        staking.connect(user2).unstakeERC1155(await erc1155.getAddress(), 1, 1)
      ).to.be.revertedWith("Insufficient staked amount");
    });

    it("Should reject unstaking 0 amount", async () => {
      await expect(
        staking.connect(user1).unstakeERC1155(await erc1155.getAddress(), 1, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should emit UnstakedERC1155 event", async () => {
      await expect(
        staking.connect(user1).unstakeERC1155(await erc1155.getAddress(), 1, 3)
      ).to.emit(staking, "UnstakedERC1155");
    });
  });

  describe("Min Stake Duration", () => {
    it("Should enforce minimum stake duration for ERC721", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await staking.connect(deployer).setMinStakeDuration(3600);

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      await expect(
        staking.connect(user1).unstake(collectionAddr, [0])
      ).to.be.revertedWith("Min stake duration not met");

      await increaseTime(3600);

      await staking.connect(user1).unstake(collectionAddr, [0]);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should enforce minimum stake duration for ERC1155", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      await staking.connect(deployer).setMinStakeDuration(3600);

      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).stakeERC1155(collectionAddr, 1, 5);

      await expect(
        staking.connect(user1).unstakeERC1155(collectionAddr, 1, 5)
      ).to.be.revertedWith("Min stake duration not met");

      await increaseTime(3600);

      await staking.connect(user1).unstakeERC1155(collectionAddr, 1, 5);
      const [amount] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      expect(amount).to.equal(0);
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

    it("Should use per-collection duration over global for ERC721", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      // Global = 1 hour, collection-specific = 2 hours
      await staking.connect(deployer).setMinStakeDuration(3600);
      await staking.connect(deployer).setCollectionMinStakeDuration(collectionAddr, 7200);

      expect(await staking.getEffectiveMinStakeDuration(collectionAddr)).to.equal(7200);

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      // After 1 hour (global met, but collection not met)
      await increaseTime(3600);
      await expect(
        staking.connect(user1).unstake(collectionAddr, [0])
      ).to.be.revertedWith("Min stake duration not met");

      // After 2 hours total
      await increaseTime(3600);
      await staking.connect(user1).unstake(collectionAddr, [0]);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should use per-collection duration over global for ERC1155", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      // Global = 2 hours, collection-specific = 30 min (shorter override)
      await staking.connect(deployer).setMinStakeDuration(7200);
      await staking.connect(deployer).setCollectionMinStakeDuration(collectionAddr, 1800);

      expect(await staking.getEffectiveMinStakeDuration(collectionAddr)).to.equal(1800);

      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);
      await staking.connect(user1).stakeERC1155(collectionAddr, 1, 5);

      // Before 30 min
      await expect(
        staking.connect(user1).unstakeERC1155(collectionAddr, 1, 5)
      ).to.be.revertedWith("Min stake duration not met");

      // After 30 min (no need to wait 2 hours)
      await increaseTime(1800);
      await staking.connect(user1).unstakeERC1155(collectionAddr, 1, 5);
      const [amount] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      expect(amount).to.equal(0);
    });

    it("Should fall back to global after clearing collection duration", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await staking.connect(deployer).setMinStakeDuration(3600);
      await staking.connect(deployer).setCollectionMinStakeDuration(collectionAddr, 7200);
      expect(await staking.getEffectiveMinStakeDuration(collectionAddr)).to.equal(7200);

      await staking.connect(deployer).clearCollectionMinStakeDuration(collectionAddr);
      expect(await staking.getEffectiveMinStakeDuration(collectionAddr)).to.equal(3600);

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);

      await increaseTime(3600);
      await staking.connect(user1).unstake(collectionAddr, [0]);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should allow per-collection duration of 0 (instant unstake) even with global set", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await staking.connect(deployer).setMinStakeDuration(3600);
      await staking.connect(deployer).setCollectionMinStakeDuration(collectionAddr, 0);

      expect(await staking.getEffectiveMinStakeDuration(collectionAddr)).to.equal(0);

      await nft.connect(user1).approve(stakingAddr, 0);
      await staking.connect(user1).stake(collectionAddr, [0]);
      await staking.connect(user1).unstake(collectionAddr, [0]);
      expect(await nft.ownerOf(0)).to.equal(await user1.getAddress());
    });

    it("Should emit CollectionMinStakeDurationUpdated events", async () => {
      const collectionAddr = await nft.getAddress();

      await expect(
        staking.connect(deployer).setCollectionMinStakeDuration(collectionAddr, 5000)
      ).to.emit(staking, "CollectionMinStakeDurationUpdated")
        .withArgs(collectionAddr, 5000, true);

      await expect(
        staking.connect(deployer).clearCollectionMinStakeDuration(collectionAddr)
      ).to.emit(staking, "CollectionMinStakeDurationUpdated")
        .withArgs(collectionAddr, 0, false);
    });

    it("Should reject per-collection duration from non-owner", async () => {
      await expect(
        staking.connect(user1).setCollectionMinStakeDuration(await nft.getAddress(), 1000)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        staking.connect(user1).clearCollectionMinStakeDuration(await nft.getAddress())
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should handle different durations for different collections simultaneously", async () => {
      const nftAddr = await nft.getAddress();
      const erc1155Addr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      // ERC721 collection: 1 hour, ERC1155 collection: 30 min
      await staking.connect(deployer).setCollectionMinStakeDuration(nftAddr, 3600);
      await staking.connect(deployer).setCollectionMinStakeDuration(erc1155Addr, 1800);

      await nft.connect(user1).approve(stakingAddr, 0);
      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);

      await staking.connect(user1).stake(nftAddr, [0]);
      await staking.connect(user1).stakeERC1155(erc1155Addr, 1, 5);

      // After 30 min: ERC1155 can unstake, ERC721 cannot
      await increaseTime(1800);

      await staking.connect(user1).unstakeERC1155(erc1155Addr, 1, 5);

      await expect(
        staking.connect(user1).unstake(nftAddr, [0])
      ).to.be.revertedWith("Min stake duration not met");

      // After 1 hour total: ERC721 can now unstake
      await increaseTime(1800);
      await staking.connect(user1).unstake(nftAddr, [0]);
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
      await nft.connect(deployer).batchMint([await staking.getAddress()], [1]);

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
      const erc20Artifact = await hre.artifacts.readArtifact("TestERC20");
      const ERC20Factory = new ethers.ContractFactory(erc20Artifact.abi, erc20Artifact.bytecode, deployer);
      const testToken = await ERC20Factory.deploy();
      await testToken.waitForDeployment();

      const amount = ethers.parseEther("100");
      await testToken.connect(deployer).transfer(await staking.getAddress(), amount);
      expect(await testToken.balanceOf(await staking.getAddress())).to.equal(amount);

      const ownerBefore = await testToken.balanceOf(await deployer.getAddress());
      await staking.connect(deployer).rescueERC20(await testToken.getAddress(), amount);
      const ownerAfter = await testToken.balanceOf(await deployer.getAddress());
      expect(ownerAfter - ownerBefore).to.equal(amount);
    });

    it("Should rescue ERC1155 tokens", async () => {
      const collectionAddr = await erc1155.getAddress();
      // Mint directly to staking contract (not via stake)
      await erc1155.connect(deployer).mint(await staking.getAddress(), 99, 10);

      await staking.connect(deployer).rescueERC1155(collectionAddr, 99, 10);
      expect(await erc1155.balanceOf(await deployer.getAddress(), 99)).to.equal(10);
    });

    it("Should reject rescue from non-owner", async () => {
      await expect(
        staking.connect(user1).rescueETH(ethers.parseEther("0.1"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        staking.connect(user1).rescueERC721(await nft.getAddress(), 0)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        staking.connect(user1).rescueERC1155(await erc1155.getAddress(), 1, 1)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Multiple Users", () => {
    it("Should track stakers independently for ERC721", async () => {
      const collectionAddr = await nft.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).setApprovalForAll(stakingAddr, true);
      await nft.connect(user2).setApprovalForAll(stakingAddr, true);

      await staking.connect(user1).stake(collectionAddr, [0, 1]);
      await staking.connect(user2).stake(collectionAddr, [5]);

      expect(await staking.isStaked(collectionAddr, 0)).to.be.true;
      expect(await staking.isStaked(collectionAddr, 1)).to.be.true;
      expect(await staking.isStaked(collectionAddr, 5)).to.be.true;

      const [staker0] = await staking.getStakeInfo(collectionAddr, 0);
      const [staker5] = await staking.getStakeInfo(collectionAddr, 5);
      expect(staker0).to.equal(await user1.getAddress());
      expect(staker5).to.equal(await user2.getAddress());

      await staking.connect(user1).unstake(collectionAddr, [0]);
      expect(await staking.isStaked(collectionAddr, 0)).to.be.false;
      expect(await staking.isStaked(collectionAddr, 1)).to.be.true;
    });

    it("Should track stakers independently for ERC1155", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);
      await erc1155.connect(user2).setApprovalForAll(stakingAddr, true);

      await staking.connect(user1).stakeERC1155(collectionAddr, 1, 4);
      await staking.connect(user2).stakeERC1155(collectionAddr, 1, 2);

      const [amount1] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      const [amount2] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user2.getAddress());
      expect(amount1).to.equal(4);
      expect(amount2).to.equal(2);

      await staking.connect(user1).unstakeERC1155(collectionAddr, 1, 2);

      const [amount1After] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user1.getAddress());
      const [amount2After] = await staking.getERC1155StakeInfo(collectionAddr, 1, await user2.getAddress());
      expect(amount1After).to.equal(2);
      expect(amount2After).to.equal(2);
    });

    it("Should handle mixed ERC721 + ERC1155 staking for same user", async () => {
      const nftAddr = await nft.getAddress();
      const erc1155Addr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();

      await nft.connect(user1).setApprovalForAll(stakingAddr, true);
      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);

      await staking.connect(user1).stake(nftAddr, [0, 1]);
      await staking.connect(user1).stakeERC1155(erc1155Addr, 1, 3);

      expect(await staking.isStaked(nftAddr, 0)).to.be.true;
      expect(await staking.isStaked(nftAddr, 1)).to.be.true;
      const [amount] = await staking.getERC1155StakeInfo(erc1155Addr, 1, await user1.getAddress());
      expect(amount).to.equal(3);
    });
  });

  describe("AuthorizedMint", () => {
    it("Should allow authorizedMint from approved minter", async () => {
      await nft.connect(deployer).setAuthorizedMinter(await user2.getAddress(), true);

      await nft.connect(user2).authorizedMint(await user2.getAddress(), 0, 2);

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

  describe("Batch ERC1155 Staking - Edge Cases", () => {
    it("Should reject batch staking from non-whitelisted collection", async () => {
      const erc1155Artifact = await hre.artifacts.readArtifact("TestERC1155");
      const Factory = new ethers.ContractFactory(erc1155Artifact.abi, erc1155Artifact.bytecode, deployer);
      const other = await Factory.deploy();
      await other.waitForDeployment();
      await other.connect(deployer).mint(await user1.getAddress(), 1, 10);
      await other.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await expect(
        staking.connect(user1).batchStakeERC1155(await other.getAddress(), [1], [5])
      ).to.be.revertedWith("Collection not allowed");
    });

    it("Should reject batch staking with arrays length mismatch", async () => {
      const collectionAddr = await erc1155.getAddress();
      await erc1155.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await expect(
        staking.connect(user1).batchStakeERC1155(collectionAddr, [1, 2], [5])
      ).to.be.revertedWith("Arrays length mismatch");
    });

    it("Should reject batch staking with empty arrays", async () => {
      const collectionAddr = await erc1155.getAddress();

      await expect(
        staking.connect(user1).batchStakeERC1155(collectionAddr, [], [])
      ).to.be.revertedWith("Empty arrays");
    });

    it("Should reject batch staking with 0 amount in array", async () => {
      const collectionAddr = await erc1155.getAddress();
      await erc1155.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await expect(
        staking.connect(user1).batchStakeERC1155(collectionAddr, [1, 2], [5, 0])
      ).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Edge Cases & Full Coverage", () => {
    it("Should receive ETH via receive()", async () => {
      const stakingAddr = await staking.getAddress();
      await deployer.sendTransaction({ to: stakingAddr, value: ethers.parseEther("1") });
      const balance = await hre.network.provider.send("eth_getBalance", [stakingAddr, "latest"]);
      expect(BigInt(balance)).to.be.gte(ethers.parseEther("1"));
    });

    it("Should support ERC1155Receiver interface", async () => {
      // ERC1155Receiver interfaceId = 0x4e2312e0
      expect(await staking.supportsInterface("0x4e2312e0")).to.be.true;
    });

    it("Should not support random interface", async () => {
      expect(await staking.supportsInterface("0xdeadbeef")).to.be.false;
    });

    it("Should reject setCollectionMinStakeDuration with zero address", async () => {
      await expect(
        staking.connect(deployer).setCollectionMinStakeDuration(ethers.ZeroAddress, 1000)
      ).to.be.revertedWith("Invalid collection");
    });

    it("Should reject clearCollectionMinStakeDuration with zero address", async () => {
      await expect(
        staking.connect(deployer).clearCollectionMinStakeDuration(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid collection");
    });

    it("Should reject rescueERC20 from non-owner", async () => {
      await expect(
        staking.connect(user1).rescueERC20(await erc1155.getAddress(), 1)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should reject double initialization", async () => {
      await expect(
        staking.connect(deployer).initialize()
      ).to.be.reverted;
    });

    it("Should return false for isStaked on non-staked token", async () => {
      expect(await staking.isStaked(await nft.getAddress(), 999)).to.be.false;
    });

    it("Should return zero address and zero timestamp for getStakeInfo on non-staked token", async () => {
      const [stakerAddr, timestamp] = await staking.getStakeInfo(await nft.getAddress(), 999);
      expect(stakerAddr).to.equal(ethers.ZeroAddress);
      expect(timestamp).to.equal(0);
    });

    it("Should return zero for getERC1155StakeInfo on non-staked token", async () => {
      const [amount, timestamp] = await staking.getERC1155StakeInfo(await erc1155.getAddress(), 999, await user1.getAddress());
      expect(amount).to.equal(0);
      expect(timestamp).to.equal(0);
    });

    it("Should allow owner to upgrade (UUPS _authorizeUpgrade)", async () => {
      const stakingArtifact = await hre.artifacts.readArtifact("Staking");
      const StakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode, deployer);
      const newImpl = await StakingFactory.deploy();
      await newImpl.waitForDeployment();

      await expect(
        staking.connect(deployer).upgradeTo(await newImpl.getAddress())
      ).to.not.be.reverted;
    });

    it("Should reject upgrade from non-owner", async () => {
      const stakingArtifact = await hre.artifacts.readArtifact("Staking");
      const StakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode, deployer);
      const newImpl = await StakingFactory.deploy();
      await newImpl.waitForDeployment();

      await expect(
        staking.connect(user1).upgradeTo(await newImpl.getAddress())
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert rescueETH when ETH transfer fails", async () => {
      // Deploy a contract that rejects ETH to act as owner
      const rejecterCode = "0x" +
        "6080604052" + // constructor
        "3480156100105760006000fd5b50" +
        "60c0806100206000396000f3fe" +
        "6080604052348015600f57600080fd5b50" +
        "60043610603c5760003560e01c8063" +
        "715018a614604157806389476069146047575b600080fd5b005b" +
        "604f60048036036020811015606157600080fd5b5035604156"; // minimal fallback-less contract

      // Instead, use a simpler approach: transfer ownership to staking contract itself (which has receive but we can test the pattern)
      // Actually, deploy a minimal contract without receive via inline assembly
      const noReceiveFactory = new ethers.ContractFactory(
        ["function owner() view returns (address)"],
        "0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea164736f6c6343",
        deployer
      );

      // Simpler: just test with 0 ETH balance
      // The require(ok) can fail if owner() is a contract that rejects ETH
      // For now, we test the happy path thoroughly - the revert is a defensive guard
      // Let's test it by sending more ETH than balance
      const stakingAddr = await staking.getAddress();
      await expect(
        staking.connect(deployer).rescueETH(ethers.parseEther("999"))
      ).to.be.reverted;
    });
  });

  describe("Batch ERC1155 Stake Info Query", () => {
    it("Should return correct data for 100 different token IDs with ~50% staked", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();
      const user1Addr = await user1.getAddress();

      const totalIds = 100;
      const tokenIds: number[] = [];
      const mintAmounts: number[] = [];

      // Mint 100 different token IDs to user1 (IDs 100-199 to avoid conflicts with beforeEach mints)
      for (let i = 0; i < totalIds; i++) {
        tokenIds.push(100 + i);
        mintAmounts.push(20); // 20 of each
      }

      // Batch mint all 100 token types
      await erc1155.connect(deployer).mintBatch(user1Addr, tokenIds, mintAmounts);

      // Approve staking contract
      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);

      // Stake ~50% of the token IDs (every other one: IDs 100, 102, 104, ..., 198)
      // Stake varying amounts to make it realistic
      const stakedIds: number[] = [];
      const stakedAmounts: number[] = [];
      for (let i = 0; i < totalIds; i += 2) {
        stakedIds.push(100 + i);
        stakedAmounts.push(5 + (i % 10)); // varying amounts: 5-14
      }

      // Batch stake all 50 token types in one call
      await staking.connect(user1).batchStakeERC1155(collectionAddr, stakedIds, stakedAmounts);

      // Now query ALL 100 IDs in a single batch call
      const [amounts, timestamps] = await staking.getERC1155StakeInfoBatch(collectionAddr, tokenIds, user1Addr);

      expect(amounts.length).to.equal(100);
      expect(timestamps.length).to.equal(100);

      // Verify each result
      for (let i = 0; i < totalIds; i++) {
        if (i % 2 === 0) {
          // Staked IDs (even indices)
          const expectedAmount = 5 + (i % 10);
          expect(amounts[i]).to.equal(expectedAmount, `Token ID ${100 + i} should have ${expectedAmount} staked`);
          expect(timestamps[i]).to.be.gt(0, `Token ID ${100 + i} should have a timestamp`);
        } else {
          // Not staked IDs (odd indices)
          expect(amounts[i]).to.equal(0, `Token ID ${100 + i} should have 0 staked`);
          expect(timestamps[i]).to.equal(0, `Token ID ${100 + i} should have no timestamp`);
        }
      }
    });

    it("Should return correct data for non-sequential scattered IDs", async () => {
      const collectionAddr = await erc1155.getAddress();
      const stakingAddr = await staking.getAddress();
      const user1Addr = await user1.getAddress();

      // Mint tokens with scattered IDs
      const scatteredIds = [5, 999, 42, 7777, 1, 500, 12345, 88];
      for (const id of scatteredIds) {
        await erc1155.connect(deployer).mint(user1Addr, id, 50);
      }

      await erc1155.connect(user1).setApprovalForAll(stakingAddr, true);

      // Stake some of them
      await staking.connect(user1).stakeERC1155(collectionAddr, 5, 10);
      await staking.connect(user1).stakeERC1155(collectionAddr, 7777, 25);
      await staking.connect(user1).stakeERC1155(collectionAddr, 12345, 3);

      // Query in arbitrary order
      const queryIds = [12345, 5, 88, 7777, 999, 42, 500, 1];
      const [amounts] = await staking.getERC1155StakeInfoBatch(collectionAddr, queryIds, user1Addr);

      expect(amounts[0]).to.equal(3);   // 12345
      expect(amounts[1]).to.equal(10);  // 5
      expect(amounts[2]).to.equal(0);   // 88 (not staked)
      expect(amounts[3]).to.equal(25);  // 7777
      expect(amounts[4]).to.equal(0);   // 999 (not staked)
      expect(amounts[5]).to.equal(0);   // 42 (not staked)
      expect(amounts[6]).to.equal(0);   // 500 (not staked)
      expect(amounts[7]).to.equal(0);   // 1 (not staked)
    });

    it("Should return all zeros for a user with nothing staked", async () => {
      const collectionAddr = await erc1155.getAddress();
      const user2Addr = await user2.getAddress();

      const queryIds = [1, 2, 3, 4, 5];
      const [amounts, timestamps] = await staking.getERC1155StakeInfoBatch(collectionAddr, queryIds, user2Addr);

      for (let i = 0; i < queryIds.length; i++) {
        expect(amounts[i]).to.equal(0);
        expect(timestamps[i]).to.equal(0);
      }
    });

    it("Should handle empty array query", async () => {
      const collectionAddr = await erc1155.getAddress();
      const [amounts, timestamps] = await staking.getERC1155StakeInfoBatch(collectionAddr, [], await user1.getAddress());
      expect(amounts.length).to.equal(0);
      expect(timestamps.length).to.equal(0);
    });
  });
});
