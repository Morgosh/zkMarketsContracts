import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployMockERC1155(hre: HardhatRuntimeEnvironment) {
  try {
    const options = {
      verify: true,
      doLog: true,
    }

    const deployParams: any = []

    console.log("🚀 Deploying MockERC1155...")
    console.log(`Network: ${hre.network.name}`)

    const contract = await deployContract("MockERC1155", deployParams, options)
    console.log("✅ Contract deployed at:", contract.target)
    
    return contract
  } catch (error) {
    console.error("❌ Deployment failed:", error)
    throw error
  }
}

// For standalone execution
if (require.main === module) {
    const hre = require("hardhat")
    deployMockERC1155(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
