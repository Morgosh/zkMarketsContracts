import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployRenderer(hre: HardhatRuntimeEnvironment) {
    console.log("🎨 DEPLOYING PROPHETS RENDERER 🎨")
    console.log("=" .repeat(60))

    console.log("🚀 Deploying ProphetsRenderer...")
    console.log(`Network: ${hre.network.name}`)
    console.log("=" .repeat(60))

    try {
        const options = {
            verify: true,
            doLog: true,
          }
        const contract = await deployContract(
            "ProphetsRenderer",
            [],
            options
        )

        console.log("✅ RENDERER SUCCESSFULLY DEPLOYED!")
        console.log("=" .repeat(60))
        console.log(`📋 Renderer Address: ${contract.target}`)
        console.log(`🔗 Network: ${hre.network.name}`)
        console.log(`💾 Storage: On-chain image storage ready`)
        console.log(`🔒 Write Protection: Images can only be stored once`)
        console.log("=" .repeat(60))
        
        console.log("🔮 NEXT STEPS:")
        console.log("1. Upload images using: npx hardhat run scripts/uploadImage.ts")
        console.log("2. Set RENDERER_ADDRESS environment variable")
        console.log("3. Deploy ProphetsOfEthereum with this renderer address")
        console.log("=" .repeat(60))
        
        console.log("📝 ENVIRONMENT VARIABLE:")
        console.log(`export RENDERER_ADDRESS=${contract.target}`)
        console.log("=" .repeat(60))
        
        return contract
    } catch (error) {
        console.error("❌ Deployment failed:", error)
        throw error
    }
}

// For standalone execution
if (require.main === module) {
    const hre = require("hardhat")
    deployRenderer(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
