import { expect } from "chai"
import hre from "hardhat"
import { Contract } from "zksync-ethers"
import ERC721TemplateABI from "../abis/ERC721Template.abi.json"
import { Signer, ethers } from "ethers"
import { deployContract, getRichWallets, getProvider } from "../utils/utils"

// console.log("deploying on ", hre.network.config)

let erc721ContractAddress: string = null!
let richWallets: Signer[] = []
let richWalletsAddresses: string[] = []

const deployParamsObj = {
  name: "Scribes",
  symbol: "SCR",
  pricePerToken: ethers.parseEther("0.042"),
}

describe("deploying", function () {
  const provider = getProvider()
  before("init", async () => {
    richWallets = await getRichWallets()
    richWalletsAddresses = await Promise.all(richWallets.map(wallet => wallet.getAddress()))
  })

  const withdrawAddress = "0x62d8B1c7FE0c8a6d3a8a8Ac051c24A06b4602e65"
  let adminContract: Contract
  it("It should deploy", async () => {
    // const deployer = new Deployer(hre, richWallets[0]);
    // const artifact = await deployer.loadArtifact('ERC721Template');

    const deployParams = [
      deployParamsObj.name, // Name of the token, if it includes space its harder to verify, you could also test with quote marks it should work, but it doesnt
      deployParamsObj.symbol, // Symbol of the token
      "ipfs://QmSQx4aRgj8x4mVP8jJajbChxL8Qexs1HB3dnspt5aHYbj", // Contract URI
      1000, // Maximum supply of the token
      deployParamsObj.pricePerToken.toString(), // Price per token in WEI
      "https://zkmarkets.infura-ipfs.io/ipfs/Qmc7VZzy1CdKHmp74eH26BBCUPxdCQNVPNr5dFS4dJJAn8/", // Default base URI of the token metadata
      "null", // URI of the token metadata when it is not yet revealed
      withdrawAddress, // withdrawAddress
      await richWallets[2].getAddress(), // _comissionRecipient
      0, // _fixedCommisionThreshold WEI
      500, // _comissionPercentageIn10000,
      await richWallets[3].getAddress(), // _defaultRoyaltyRecipient
      500, // _defaultRoyaltyPercentage in 10000 denominator
    ]
    adminContract = await deployContract("ERC721Template", deployParams)
    adminContract = new Contract(await adminContract.getAddress(), ERC721TemplateABI, richWallets[0])
    erc721ContractAddress = await adminContract.getAddress()
    expect(await adminContract.name()).to.eq(deployParams[0])
    expect(await adminContract.symbol()).to.eq(deployParams[1])
  })
  it("richWallets[0] interaction works", async () => {
    console.log(await richWallets[0].getAddress(), 1)
    expect(await adminContract.name()).to.eq(deployParamsObj.name)
    expect(await adminContract.symbol()).to.eq(deployParamsObj.symbol)
  })
  it("Admin mint should work for admin", async () => {
    const tx = await adminContract.adminMint(richWalletsAddresses[0], 1)
    const finishedTx = await tx.wait()
    expect(finishedTx.status).to.eq(1)
    expect(parseInt(await adminContract.totalSupply())).to.eq(1)
    expect(parseInt(await adminContract.balanceOf(richWalletsAddresses[0]))).to.eq(1)
  })
  it("Admin mint should not for others", async () => {
    const contractWithWallet2 = new Contract(erc721ContractAddress, ERC721TemplateABI, richWallets[1])
    try {
      const tx = await contractWithWallet2.adminMint(richWalletsAddresses[1], 1)
      await tx.wait()
      throw new Error("Should have failed")
    }
    catch (err: any) {
      expect(err.message).to.include("revert")
    }
  })
  it("Public mint should not work when not live", async () => {
    const contract = new Contract(erc721ContractAddress, ERC721TemplateABI, richWallets[0])
    try {
      const tx = await contract.mint(1, { value: deployParamsObj.pricePerToken })
      await tx.wait()
      throw new Error("Should have failed")
    }
    catch (err: any) {
      expect(err.message).to.include("Public sale not active")
    }
  })
  it("Public mint should work when live", async () => {
    // Activate the contract for public sale
    let tx = await adminContract.togglePublicSaleActive()
    await tx.wait()

    const contract = new Contract(erc721ContractAddress, ERC721TemplateABI, richWallets[0])
    const initialTotalSupply = parseInt(await contract.totalSupply())
    tx = await contract.mint(1, { value: ethers.parseEther("0.042") })
    const finishedTx = await tx.wait()
    expect(finishedTx.status).to.eq(1)
    const newTotalSupply = parseInt(await contract.totalSupply())
    expect(newTotalSupply).to.eq(initialTotalSupply + 1)
  })

  let newMintPrice: bigint
  it("Minting fails if sending less than the mint price, but works if enough", async () => {
    newMintPrice = ethers.parseEther("0.01") // setting new mint price to 0.01 ETH
    let tx = await adminContract.setPublicPrice(newMintPrice)
    await tx.wait()

    // Try minting with less than the mint price
    const contract = new Contract(erc721ContractAddress, ERC721TemplateABI, richWallets[0])
    const lessThanMintPrice = ethers.parseEther("0.005") // Half of the mint price

    try {
      tx = await contract.mint(1, { value: lessThanMintPrice })
      await tx.wait()
      throw new Error("Minting should have failed because the sent amount was less than the mint price")
    }
    catch (err: any) {
      expect(err.message).to.include("Cost is higher")
    }
    tx = await contract.mint(1, { value: newMintPrice })
    const finishedTx = await tx.wait()
    expect(finishedTx.status).to.eq(1)
  })
  it("minting fails if going over the max supply", async () => {
    const maxSupply = parseInt(await adminContract.maxSupply())
    const totalSupply = parseInt(await adminContract.totalSupply())
    const remainingSupply = maxSupply - totalSupply
    const mintAmount = remainingSupply + 1
    try {
      const tx = await adminContract.mint(mintAmount, { value: deployParamsObj.pricePerToken })
      await tx.wait()
      throw new Error("Minting should have failed because the mint amount was more than the remaining supply")
    }
    catch (err: any) {
      expect(err.message).to.include("Total supply exceeded")
    }
  })

  let ERC20Contract: Contract
  // lets test mintWithFixedERC20Price(uint256 _mintAmount)
  it("Mint with fixed ERC20 price", async function () {
    const wallet1Contract = new Contract(erc721ContractAddress, ERC721TemplateABI, richWallets[0])
    const erc721BalanceBefore = await wallet1Contract.balanceOf(richWalletsAddresses[0])

    // // lets togglePublicSaleActive
    // const tx1 = await wallet1Contract.togglePublicSaleActive()
    // await tx1.wait()

    const k = 1
    const price = 100 // in WEI

    try {
      await wallet1Contract.mintWithFixedERC20Price(k)
      throw new Error("Should have failed")
    }
    catch (error: any) {
      expect(error.message).to.include("Payment token address not set")
    }

    // lets create erc20
    ERC20Contract = await deployContract("ERC20Template", ["name", "symbol"])
    const txC = await ERC20Contract.adminMint(richWalletsAddresses[0], 50)
    await txC.wait()
    wallet1Contract.setERC20TokenAddress(await ERC20Contract.getAddress())

    try {
      await wallet1Contract.mintWithFixedERC20Price(k)
      throw new Error("Should have failed")
    }
    catch (error: any) {
      expect(error.message).to.include("Price per token not set")
    }

    const tx3 = await wallet1Contract.setErc20FixedPricePerToken(price)
    await tx3.wait()

    // ERC20InsufficientAllowance
    try {
      await wallet1Contract.mintWithFixedERC20Price(k)
      throw new Error("Should have failed")
    }
    catch (error: any) {
      expect(error.message).to.include("ERC20InsufficientAllowance")
    }

    // lets approve
    const tx4 = await ERC20Contract.approve(erc721ContractAddress, price)
    await tx4.wait()

    // ERC20InsufficientBalance
    try {
      await wallet1Contract.mintWithFixedERC20Price(k)
      throw new Error("Should have failed")
    }
    catch (error: any) {
      expect(error.message).to.include("ERC20InsufficientBalance")
    }

    // lets mint
    const txC2 = await ERC20Contract.adminMint(richWalletsAddresses[0], 50)
    await txC2.wait()

    const tx = await wallet1Contract.mintWithFixedERC20Price(k)
    await tx.wait()
    const erc721balanceAfter = await wallet1Contract.balanceOf(richWalletsAddresses[0])
    expect(erc721balanceAfter).to.equal(erc721BalanceBefore + BigInt(k))
    // and check erc20 balance
    // const erc20Balance = await wallet1Contract.balanceOf(richWalletsAddresses[0]);
  })

  // network is zksyncera testnet
  if (hre.network.name == "zksync-era-testnet") {
    console.log("Testing on zksync-era-testnet")
    it("test mintWithERC20ChainlinkPrice", async function () {
      await adminContract.getRequiredErc20Tokens()
      expect(ERC20Contract).to.not.be.undefined
      // todo, but doesn't work with rich wallets
    })
  }

  // getLaunchpadDetails
  it("getLaunchpadDetails", async function () {
    const wallet1Contract = new Contract(erc721ContractAddress, ERC721TemplateABI, richWallets[0])

    // function getLaunchpadDetails() public view returns (uint256, uint256, uint256, uint256) {
    // return (maxSupply, publicPrice, totalSupply(), publicSaleStartTime);
    const details = await wallet1Contract.getLaunchpadDetails()
    console.log(details)
    const detailsObj = {
      maxSupply: details[0],
      publicPrice: details[1],
      totalSupply: details[2],
      publicSaleStartTime: details[3],
    }

    expect(detailsObj.maxSupply).to.equal(BigInt(1000))
    expect(detailsObj.publicPrice).to.equal(newMintPrice)
    expect(detailsObj.totalSupply).to.equal(await wallet1Contract.totalSupply())
    // expect(detailsObj.publicSaleStartTime).to.equal(0) something...
  })

  it("withdrawal works", async function () {
    const balanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
    // get balance on contract
    const contractBalanceBefore = parseFloat(ethers.formatEther(await provider.getBalance(erc721ContractAddress)))

    const tx = await adminContract.withdraw()
    await tx.wait()
    const balanceAfter = parseFloat(ethers.formatEther(await provider.getBalance(withdrawAddress)))
    // balance on contractAfter
    const contractBalanceAfter = parseFloat(ethers.formatEther(await provider.getBalance(erc721ContractAddress)))
    expect(contractBalanceAfter).to.be.lt(contractBalanceBefore)
    expect(balanceAfter).to.be.gt(balanceBefore)

    // we have to test erc20 withdrawal withdrawERC20(address erc20Token)
    // lets check balance of erc20 ERC20Contract
    const erc20UserBalanceBefore = await ERC20Contract.balanceOf(withdrawAddress)
    const erc20ContractBalanceBefore = await ERC20Contract.balanceOf(erc721ContractAddress)
    const tx2 = await adminContract.withdrawERC20(await ERC20Contract.getAddress())
    await tx2.wait()
    const erc20UserBalanceAfter = await ERC20Contract.balanceOf(withdrawAddress)
    await ERC20Contract.balanceOf(erc721ContractAddress)
    expect(erc20UserBalanceAfter).to.be.eq(
      erc20UserBalanceBefore
      // comission is 5%
      + (erc20ContractBalanceBefore) * BigInt(95) / BigInt(100),
    )
    // expect(erc20ContractBalanceAfter).to.be.lt(erc20ContractBalanceBefore)
  })
})
