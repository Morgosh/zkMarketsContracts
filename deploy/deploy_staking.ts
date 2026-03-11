import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployStaking(hre: HardhatRuntimeEnvironment) {
    console.log("🔒 DEPLOYING STAKING CONTRACT 🔒")
    console.log("=" .repeat(60))

    console.log(`Network: ${hre.network.name}`)
    console.log("=" .repeat(60))

    try {
        const options = {
            verify: true,
            doLog: true,
        }
        const contract = await deployContract(
            "Staking",
            [],
            options
        )

        console.log("✅ STAKING CONTRACT DEPLOYED!")
        console.log("=" .repeat(60))
        console.log(`📋 Staking Contract: ${contract.target}`)
        console.log(`🔗 Network: ${hre.network.name}`)
        console.log("=" .repeat(60))

        console.log("🔮 NEXT STEPS:")
        console.log("1. Add allowed collections via setAllowedCollection()")
        console.log("2. Optionally set min stake duration via setMinStakeDuration()")
        console.log("3. Users can now stake NFTs from allowed collections")
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
    deployStaking(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
