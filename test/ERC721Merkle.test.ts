import { expect } from "chai"
import { Contract } from "zksync-ethers"
import { Signer, ethers } from "ethers"
import merkleABI from "../abis/ERC721Merkle.abi.json"
import "@nomicfoundation/hardhat-chai-matchers"

import { getLeafNodes, getRootHash, getProof } from "../merkle/merkleFunctions"
import { MerkleTree } from "merkletreejs"
import keccak256 from "keccak256"
import { deployContract, getProvider, getRichWallets } from "../utils/utils"

// console.log("deploying on ", hre.network.config)
const provider = getProvider()

// loop through richWallets and connect provider to wallet to new array

const withdrawAddress = "0xFF383ED09aE2D216BD37B03797DD9a3A0f75c77a"
const deployParams = [
  "Zeeks", // Name of the token, if it includes space its harder to verify, you could also test with quote marks it should work, but it doesnt
  "ZEEKS", // Symbol of the token
  "", // Contract URI  "ipfs://QmSQx4aRgj8x4mVP8jJajbChxL8Qexs1HB3dnspt5aHYbj"
  9999, // Maximum supply of the token
  ethers.parseEther("0.04").toString(), // Price per token during public minting
  "null", // Default base URI of the token metadata ei "https://zkmarkets.infura-ipfs.io/ipfs/Qmc7VZzy1CdKHmp74eH26BBCUPxdCQNVPNr5dFS4dJJAn8/""
  "null", // URI of the token metadata when it is not yet revealed "null" if not used
  withdrawAddress, // withdrawAddress
  "0x8F995E8961D2FF09d444aB4eC72d67f36aa2c8CC", // _comissionRecipient
  0, // _fixedCommisionTreshold WEI
  100, // _comissionPercentageIn10000,
  "0xAA4306c1b90782Ce2710D9512beCD03168eaF7A2", // _defaultRoyaltyRecipient
  500, // _defaultRoyaltyPercentage in 10000 denominator
]

let adminContract: Contract = null!
let adminContractAddress: string = null!
let richWallets: Signer[] = []
let richWalletsAddresses: string[] = []

let tier1Addresses: string[] = []
let tier2Addresses: string[] = []
const tier3Data = {
  addresses: [] as string[],
  priceWei: ethers.parseEther("0.03"),
  tier: 3,
  maxMint: 50,
  startTime: 0,
}

describe("ERC721Merkle Test", function () {
  before("init", async () => {
    richWallets = await getRichWallets()
    richWalletsAddresses = await Promise.all(richWallets.map(wallet => wallet.getAddress()))

    tier1Addresses = [
      richWalletsAddresses[0],
      richWalletsAddresses[1],
      richWalletsAddresses[2],
    ]

    tier2Addresses = [
      richWalletsAddresses[3],
      richWalletsAddresses[4],
      richWalletsAddresses[5],
    ]

    tier3Data.addresses = [
      richWalletsAddresses[6],
      richWalletsAddresses[7],
      richWalletsAddresses[8],
    ]
  })

  it("It should deploy", async () => {
    adminContract = await deployContract("ERC721Merkle", deployParams)
    adminContractAddress = await adminContract.getAddress()

    expect(await adminContract.name()).to.eq(deployParams[0])
    expect(await adminContract.symbol()).to.eq(deployParams[1])
  })

  // function setTier(uint256 tierId, bytes32 merkleRoot, uint256 price, uint256 maxMintAmount, uint256 saleStartTime) external onlyOwner {
  //   Tier storage tier = tiers[tierId];
  //   tier.merkleRoot = merkleRoot;
  //   tier.price = price;
  //   tier.maxMintAmount = maxMintAmount;
  //   tier.saleStartTime = saleStartTime; // type(uint256).max; is used to disable the tier
  //   if(tiers[tierId].merkleRoot == bytes32(0)) {
  //       tierIds.push(tierId); // Add tierId to the array if it's a new tier
  //   }
  // }

  let tier1MerkleTree: MerkleTree
  let tier2MerkleTree: MerkleTree
  let tier3MerkleTree: MerkleTree
  it("sets the MerkleTree for tiers", async () => {
    // set start to max
    tier1MerkleTree = new MerkleTree(getLeafNodes(tier1Addresses), keccak256, { sortPairs: true })
    tier2MerkleTree = new MerkleTree(getLeafNodes(tier2Addresses), keccak256, { sortPairs: true })
    tier3MerkleTree = new MerkleTree(getLeafNodes(tier3Data.addresses), keccak256, { sortPairs: true })
    const a = await adminContract.setTier(1, "wl", getRootHash(tier1MerkleTree), ethers.parseEther("0.02"), ethers.parseEther("2"), 1, ethers.MaxUint256)
    const b = await adminContract.setTier(2, "OG", getRootHash(tier2MerkleTree), ethers.parseEther("0.01"), ethers.parseEther("1"), 2, ethers.MaxUint256)
    const c = await adminContract.setTier(3, "BIG", getRootHash(tier3MerkleTree), tier3Data.priceWei, ethers.parseEther("3"), tier3Data.maxMint, tier3Data.startTime)

    const tierDetails = await adminContract.getTierDetails(3)

    // function getTierDetails(uint256 tierId) external view returns (bytes32 merkleRoot, uint256 price, uint256 maxMintAmount, uint256 saleStartTime, string memory title, uint256 ERC20Price) {
    expect(tierDetails[0]).to.eq(getRootHash(tier3MerkleTree))
    expect(tierDetails[1]).to.eq(tier3Data.priceWei)
    expect(tierDetails[2]).to.eq(BigInt(tier3Data.maxMint))
    // expect(tierDetails[3]).to.eq(tier3Data.startTime)
    expect(tierDetails[4]).to.eq("BIG")
    expect(tierDetails[5].toString()).to.eq("0")

    await a.wait()
    await b.wait()
    await c.wait()
  })

  it("quick mint test", async function () {
    const customWallet = richWallets[6]
    // send some eth on wallet
    // const tx1 = await customWallet.sendTransaction({
    //   to: richWalletsAddresses[4],
    //   value: ethers.parseEther("1")
    // });
    // await tx1.wait();
    const contract = new Contract(adminContractAddress, merkleABI, customWallet)
    const k = 1
    const proof = getProof(await customWallet.getAddress(), tier3MerkleTree)
    const tierDetails = await adminContract.getTierDetails(3)
    const price = tierDetails[1] as bigint
    const tx = await contract.whitelistMint(3, k, proof, { value: price })
    await tx.wait()
    const balance = await contract.balanceOf(await customWallet.getAddress())
    expect(balance).to.equal(BigInt(k))

    const balanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
    // get balance on contract
    const contractBalanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(adminContractAddress)))
    console.log("balanceBefore1", balanceBefore, "contractBalanceBefore1", contractBalanceBefore)
  })
  it("Whitelist not active", async function () {
    const wallet1Contract = new Contract(adminContractAddress, merkleABI, richWallets[0])
    const t1Proof = getProof(tier1Addresses[0], tier1MerkleTree)
    const whitelistPrice = ethers.parseEther("0.01")

    await expect(wallet1Contract.whitelistMint(1, 1, t1Proof, { value: whitelistPrice })).to.be.revertedWith("Tier sale not started");
    
    // Activate whitelist 1 and 2
    const activateWhitelistTx = await adminContract.enableTier(1)
    const activateWhitelistTx2 = await adminContract.enableTier(2)
    await activateWhitelistTx.wait()
    await activateWhitelistTx2.wait()
  })
  it("Insufficient funds for mint", async function () {
    const wallet1Contract = new Contract(adminContractAddress, merkleABI, richWallets[0])
    const t1Proof = getProof(tier1Addresses[0], tier1MerkleTree)
    const k = 1
    const tierDetails = await adminContract.getTierDetails(1)
    const price = tierDetails[1] as bigint
    
    await expect(wallet1Contract.whitelistMint(1, k, t1Proof, { value: price - BigInt(1) })).to.be.revertedWith("Insufficient funds for mint");
  })
  it("Cannot mint more than max supply", async function () {
    const wallet1Contract = new Contract(adminContractAddress, merkleABI, richWallets[0])
    const maxSupply = await adminContract.maxSupply() as bigint
    const t1Proof = getProof(tier1Addresses[0], tier1MerkleTree)
    const k = maxSupply + BigInt(1)
    const tierDetails = await adminContract.getTierDetails(1)
    const price = tierDetails[1] as bigint

    await expect(wallet1Contract.whitelistMint(1, k, t1Proof, { value: price * k })).to.be.revertedWith("Exceeds tier max mint amount");
  })
  it("Not prelisted", async function () {
    const wallet1Contract = new Contract(adminContractAddress, merkleABI, richWallets[5])
    const t1Proof = getProof(tier1Addresses[0], tier1MerkleTree)
    const k = BigInt(1)
    const tierDetails = await adminContract.getTierDetails(1)
    const price = tierDetails[1] as bigint

    await expect(wallet1Contract.whitelistMint(1, k, t1Proof, { value: price * k })).to.be.revertedWith("Not in presale list for this tier");
  })
  it("allows a pre-listed address to mint during whitelist", async function () {
    const wallet1Contract = new Contract(adminContractAddress, merkleABI, richWallets[0])
    const t1Proof = getProof(tier1Addresses[0], tier1MerkleTree)
    const k = 1
    const tierDetails = await adminContract.getTierDetails(1)
    const price = tierDetails[1] as bigint
    const tx = await wallet1Contract.whitelistMint(1, k, t1Proof, { value: price })
    await tx.wait()

    // Check the balance of the validAddress
    const balance = await wallet1Contract.balanceOf(richWalletsAddresses[0])
    expect(balance).to.equal(BigInt(k))
  })
  it("Already minted too much", async function () {
    const wallet1Contract = new Contract(adminContractAddress, merkleABI, richWallets[0])
    const t1Proof = getProof(tier1Addresses[0], tier1MerkleTree)
    const k = 1
    const tierDetails = await adminContract.getTierDetails(1)
    const price = tierDetails[1] as bigint

    await expect(wallet1Contract.whitelistMint(1, k, t1Proof, { value: price })).to.be.revertedWith("Exceeds tier max mint amount");
  })
  it("But another can mint 2 in tier 2", async function () {
    const wallet2Contract = new Contract(adminContractAddress, merkleABI, richWallets[4])
    const t2Proof = getProof(richWalletsAddresses[4], tier2MerkleTree)
    const tier = 2
    const k = BigInt(2)
    const tierDetails = await adminContract.getTierDetails(tier)
    const price = tierDetails[1] as bigint
    const tx = await wallet2Contract.whitelistMint(tier, k, t2Proof, { value: price * k })
    await tx.wait()

    // Check the balance of the validAddress
    const balance = await wallet2Contract.balanceOf(richWalletsAddresses[4])
    expect(balance).to.equal(BigInt(k))
  })
  it("withdrawal works", async function () {
    const balanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
    // get balance on contract
    const contractBalanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(adminContractAddress)))

    const tx = await adminContract.withdraw()
    await tx.wait()
    const balanceAfter = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
    // balance on contractAfter
    const contractBalanceAfter = parseFloat(ethers.formatEther(await provider.getBalance(adminContractAddress)))
    expect(contractBalanceAfter).to.be.lt(contractBalanceBefore)
    expect(balanceAfter).to.be.gt(balanceBefore)
  })
  it("royaltyInfo returns 5%", async () => {
    const tokenId = 1
    const salePrice = ethers.parseEther("1") // 1 Ether

    const result = await adminContract.royaltyInfo(tokenId, salePrice)
    const royaltyAmount = ethers.formatEther(result[1]) // Convert Wei to Ether
    const royaltyPercentage = (parseFloat(royaltyAmount) / parseFloat(ethers.formatEther(salePrice))) * 100 // Calculate percentage

    expect(result[0].toLowerCase()).to.eq("0xAA4306c1b90782Ce2710D9512beCD03168eaF7A2".toLowerCase())
    expect(royaltyPercentage).to.eq(5) // Checking the royalty percentage instead of the royalty amount
  })
})
