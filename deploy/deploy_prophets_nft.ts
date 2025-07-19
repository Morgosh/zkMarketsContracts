import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"
import { ethers } from "hardhat"

export default async function (hre: HardhatRuntimeEnvironment) {
  const options = {
    verify: true,
    doLog: true,
  }

  const network = hre.network.name
  console.log(`Deploying to network: ${network}`)

  let pythContractAddress: string
  
  // ETH/USD price feed ID (standard across all chains)
  const ethUsdPriceId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"

  // Use different Pyth contracts based on network
  if (network === "abstract-testnet") {
    // For Abstract testnet, deploy MockPyth for testing
    console.log("Deploying MockPyth for testnet...")
    const mockPythParams: any = []
    const mockPyth = await deployContract("MockPythExtended", mockPythParams, options)
    pythContractAddress = await mockPyth.getAddress()
    
    // Set initial ETH price in mock contract
    console.log("Setting initial ETH price in MockPyth...")
    const setPriceTx = await mockPyth.setCurrentPrice(ethUsdPriceId, 200000000000) // $2000 with 8 decimals
    await setPriceTx.wait()
    console.log("Initial price set successfully")
    
  } else if (network === "abstract") {
    // For Abstract mainnet, use the actual Pyth contract
    // Note: You'll need to find the actual Pyth contract address for Abstract mainnet
    // Check https://docs.pyth.network/price-feeds/contract-addresses/evm for the latest address
    
    // Official Pyth Network contract address for Abstract mainnet
    pythContractAddress = "0x8739d5024B5143278E2b15Bd9e7C26f6CEc658F1"
    
    console.log(`Using Pyth contract at: ${pythContractAddress}`)
    
  } else {
    // For other networks (like hardhat), use MockPyth
    console.log("Deploying MockPyth for local/test network...")
    const mockPythParams: any = []
    const mockPyth = await deployContract("MockPythExtended", mockPythParams, options)
    pythContractAddress = await mockPyth.getAddress()
    
    // Set initial ETH price in mock contract
    console.log("Setting initial ETH price in MockPyth...")
    const setPriceTx = await mockPyth.setCurrentPrice(ethUsdPriceId, 200000000000)
    await setPriceTx.wait()
    console.log("Initial price set successfully")
  }

  // Deploy ProphetsNFT contract
  console.log("Deploying ProphetsNFT contract...")
  const deployParams = [
    "666 Prophets",
    "PROPHET", 
    pythContractAddress,
    ethUsdPriceId,
    "20000000000000000" // 0.02 ETH in wei as string to avoid BigInt serialization issues
  ]
  
  const prophetsNFT = await deployContract("ProphetsNFT", deployParams, options)
  
  console.log("\n=== Deployment Summary ===")
  console.log(`Network: ${network}`)
  console.log(`Pyth Contract: ${pythContractAddress}`)
  console.log(`ProphetsNFT Contract: ${await prophetsNFT.getAddress()}`)
  console.log(`ETH/USD Price Feed ID: ${ethUsdPriceId}`)
  console.log(`Mint Price: 0.02 ETH`)
  console.log("=========================\n")

  return { prophetsNFT, pythContractAddress }
} 