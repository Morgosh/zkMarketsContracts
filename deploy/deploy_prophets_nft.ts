import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"
import { ethers } from "hardhat"

export default async function (hre: HardhatRuntimeEnvironment) {
  const options = {
    verify: true,
    doLog: true,
  }

  // Deploy mock Pyth contract first
  console.log("Deploying mock Pyth contract...")
  const mockPythParams: any = []
  
  const mockPyth = await deployContract("MockPythExtended", mockPythParams, options)
  const pythContractAddress = await mockPyth.getAddress()

  // ETH/USD price feed ID (standard across all chains)
  const ethUsdPriceId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"

  // Set initial ETH price in mock contract (e.g., $2000)
  await mockPyth.setCurrentPrice(ethUsdPriceId, 200000000000) // $2000 with 8 decimals

  // Deploy ProphetsNFT contract
  const deployParams = [
    "666 Prophets",
    "PROPHET", 
    pythContractAddress,
    ethUsdPriceId,
    ethers.parseEther("0.02") // 0.02 ETH mint price
  ]
  
  const prophetsNFT = await deployContract("ProphetsNFT", deployParams, options)
} 