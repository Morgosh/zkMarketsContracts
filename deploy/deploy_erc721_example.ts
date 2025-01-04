import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"
import { ethers } from "hardhat"
// its initialized in hardhat.config.ts
// initializeDotenv(network, getMainnetOrTestnet(network));

const network: string = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "testnet"

export default async function (_: HardhatRuntimeEnvironment) {

  const collectionParams = {
    name: "Zeeks",
    symbol: "ZEEKS",
    description: "zeeks is a cool collection",
    isLaunchpad: true,
    socials: {
      twitter: "https://x.com/xzy",
      discord: "https://discord.com/xzy",
      website: "https://xzy.com/",
    },
    mintDateTimeStamp: 1736276400, 
    bannerImageUrl: "url",
    imageUrl: "url",
    royalty: 5,
    listenToEvents: true,
    isVerified: true,
    featuredPriority: 1,
  }

  const withdrawAddress = "0xFF383ED09aE2D216BD37B03797DD9a3A0f75c77a"
  const deployParams = [
    collectionParams.name, // Name of the collection
    collectionParams.symbol, // Symbol of the collection
    "", // Contract URI  "ipfs://QmSQx4aRgj8x4mVP8jJajbChxL8Qexs1HB3dnspt5aHYbj"
    9999, // Maximum supply of the token
    ethers.parseEther("0.04").toString(), // Price per token during public minting
    "ipfs://QmaD7f7L1RPVy2MrkaH6byfSBAAUB271rrAu5zRZNkmTz7/", // Default base URI of the token metadata ei "ipfs://QmaD7f7L1RPVy2MrkaH6byfSBAAUB271rrAu5zRZNkmTz7/" don't forget the last "/"
    "", // URI of the token metadata when it is not yet revealed use "undefined" if not used
    withdrawAddress, // withdrawAddress
    "0x8F995E8961D2FF09d444aB4eC72d67f36aa2c8CC", // _comissionRecipient
    0, // _fixedCommisionThreshold WEI
    100, // _comissionPercentageIn10000,
    "0xAA4306c1b90782Ce2710D9512beCD03168eaF7A2", // _defaultRoyaltyRecipient
    collectionParams.royalty*100, // _defaultRoyaltyPercentage in 10000 denominator
  ]

  const options = {
    verify: true,
    doLog: true,
  }

  const adminContract = await deployContract("ERC721Merkle", deployParams, options)
  const adminContractAddress = await adminContract.getAddress()

  // we must now set mint date
  await adminContract.setPublicSaleStartTime(collectionParams.mintDateTimeStamp)

  // you can optionally setERC20TokenAddress
  //await adminContract.setERC20TokenAddress("0xAddress")
  //await adminContract.setErc20FixedPricePerToken(ethers.utils.parseEther("0.04"))

}
