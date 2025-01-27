import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"
import { ethers } from "hardhat"

const network: string = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "testnet"

export default async function (_: HardhatRuntimeEnvironment) {
  const collectionParams = {
    name: "Abstract x zkMarkets",
    symbol: "abszkm",
    description: "A welcome collection for zkMarkets",
    isLaunchpad: true,
    socials: {
      twitter: "https://x.com/zkmarkets",
      // discord: "https://x.com/upzkgorilla",
      website: "https://www.zkmarkets.com/",
    },
    mintDateTimeStamp: 1736276400,
    bannerImageUrl: "https://imagedelivery.net/x2iJebajGM05Veyygt4xdQ/60548ecd-64bb-4cec-abc8-c873c1873000/2000contain",
    imageUrl: "https://imagedelivery.net/x2iJebajGM05Veyygt4xdQ/a1e84706-1848-4b6c-a213-021105537100/1000contain",
    royalty: 0,
    listenToEvents: true,
    isVerified: true,
    featuredPriority: 1,
  }

  const withdrawAddress = "0xc4ABd8d2315F51C6Eb95052d64eF52Ba9767E373"

  const deployParams = [
    collectionParams.name, // Name of the collection
    collectionParams.symbol, // Symbol of the collection
    "ipfs://QmbxoW1YVbdnwhEhj9J5vdMJN7haySnDQEyiTEicPyNDZw", // Contract URI  "ipfs://QmSQx4aRgj8x4mVP8jJajbChxL8Qexs1HB3dnspt5aHYbj"
    10000, // Maximum supply of the token
    0, // Price per token during public minting
    "", // Default base URI of the token metadata ei "ipfs://QmaD7f7L1RPVy2MrkaH6byfSBAAUB271rrAu5zRZNkmTz7/" don't forget the last "/"
    "ipfs://QmVNpBmo52S1t2xkMWVuEqQf87ATRCABHMb8axtyp9TtkC", // URI of the token metadata when it is not yet revealed leave empty if not used
    withdrawAddress, // withdrawAddress
    withdrawAddress, // _comissionRecipient use null or withdrawAddress when not used
    0, // _fixedCommisionThreshold WEI
    0, // _comissionPercentageIn10000,
    withdrawAddress, // _defaultRoyaltyRecipient
    collectionParams.royalty * 100, // _defaultRoyaltyPercentage in 10000 denominator
  ]

  const options = {
    verify: true,
    doLog: true,
  }

  const adminContract = await deployContract("ERC721Merkle", deployParams, options)
  const contractAddress = (await adminContract.getAddress()).toLowerCase()
  console.log("contractAddress", contractAddress)
  await adminContract.setPublicSaleStartTime(1)
}
