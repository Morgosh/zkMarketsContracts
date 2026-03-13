import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"
import { ethers } from "ethers"

export default async function deployStaking(hre: HardhatRuntimeEnvironment) {
    console.log("🔒 DEPLOYING STAKING CONTRACT (UUPS Proxy) 🔒")
    console.log("=" .repeat(60))

    console.log(`Network: ${hre.network.name}`)
    console.log("=" .repeat(60))

    try {
        const options = {
            verify: true,
            doLog: true,
        }

        // Step 1: Deploy implementation contract
        console.log("\n📦 Step 1: Deploying implementation...")
        const implContract = await deployContract(
            "Staking",
            [], // no constructor args — _disableInitializers() runs automatically
            options
        )
        const implAddress = await implContract.getAddress()
        console.log(`   Implementation: ${implAddress}`)

        // Step 2: Encode initialize() calldata
        console.log("\n📝 Step 2: Encoding initialize calldata...")
        const iface = new ethers.Interface([
            "function initialize()"
        ])
        const initData = iface.encodeFunctionData("initialize", [])

        // Step 3: Deploy ERC1967Proxy
        console.log("\n🔗 Step 3: Deploying ERC1967Proxy...")
        const proxyContract = await deployContract(
            "ERC1967Proxy",
            [implAddress, initData],
            options
        )
        const proxyAddress = await proxyContract.getAddress()
        console.log(`   Proxy: ${proxyAddress}`)

        // Summary
        console.log("\n" + "=".repeat(60))
        console.log("✅ STAKING CONTRACT DEPLOYED!")
        console.log("=".repeat(60))
        console.log(`📋 Proxy (use this):        ${proxyAddress}`)
        console.log(`📋 Implementation:          ${implAddress}`)
        console.log(`🔗 Network:                 ${hre.network.name}`)
        console.log("=".repeat(60))

        console.log("\n🔮 NEXT STEPS:")
        console.log("1. Add allowed collections via setAllowedCollection()")
        console.log("2. Optionally set min stake duration via setMinStakeDuration()")
        console.log("3. Users can now stake ERC721 and ERC1155 NFTs from allowed collections")
        console.log("=".repeat(60))

        return { proxy: proxyContract, implementation: implContract, proxyAddress, implAddress }
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
