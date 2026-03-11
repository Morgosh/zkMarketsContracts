import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"
import { ethers } from "ethers"

export default async function deployMoodyArchives(hre: HardhatRuntimeEnvironment) {
    console.log("🎨 DEPLOYING MoodyArchives (UUPS Proxy) 🎨")
    console.log("=".repeat(60))
    console.log(`Network: ${hre.network.name}`)
    console.log("=".repeat(60))

    // ==============================
    // Configuration — UPDATE THESE
    // ==============================
    const royaltyReceiver = "0x1BC6507e9cdcb90aD6193f57cc09701722e158A6"
    const royaltyFeeNumerator = 500 // 5% royalty (500 basis points)
    const name = "Moody Archives"
    const symbol = "MA"
    const baseTokenURI = ""

    try {
        const options = {
            verify: true,
            doLog: true,
        }

        // Step 1: Deploy implementation contract
        console.log("\n📦 Step 1: Deploying implementation...")
        const implContract = await deployContract(
            "MoodyArchives",
            [], // no constructor args — _disableInitializers() runs automatically
            options
        )
        const implAddress = await implContract.getAddress()
        console.log(`   Implementation: ${implAddress}`)

        // Step 2: Encode initialize() calldata
        console.log("\n📝 Step 2: Encoding initialize calldata...")
        const iface = new ethers.Interface([
            "function initialize(address royaltyReceiver_, uint96 royaltyFeeNumerator_, string name_, string symbol_, string baseTokenURI_)"
        ])
        const initData = iface.encodeFunctionData("initialize", [
            royaltyReceiver,
            royaltyFeeNumerator,
            name,
            symbol,
            baseTokenURI
        ])
        console.log(`   Royalty Receiver: ${royaltyReceiver}`)
        console.log(`   Royalty Fee: ${royaltyFeeNumerator / 100}%`)
        console.log(`   Name: ${name}`)
        console.log(`   Symbol: ${symbol}`)
        console.log(`   Base URI: ${baseTokenURI}`)

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
        console.log("✅ DEPLOYMENT COMPLETE!")
        console.log("=".repeat(60))
        console.log(`📋 Proxy (use this):        ${proxyAddress}`)
        console.log(`📋 Implementation:          ${implAddress}`)
        console.log(`🔗 Network:                 ${hre.network.name}`)
        console.log("=".repeat(60))

        console.log("\n🔮 NEXT STEPS:")
        console.log("1. Verify proxy on block explorer (implementation should auto-verify)")
        console.log("2. Set transfer validator via setTransferValidator() if needed")
        console.log("3. Set authorized minters via setAuthorizedMinter() if needed")
        console.log("4. Mint tokens via batchMint() or authorizedMint()")
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
    deployMoodyArchives(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
