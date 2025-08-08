import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployProphets(hre: HardhatRuntimeEnvironment) {
    console.log("🔥 SUMMONING THE PROPHETS OF ETHEREUM 🔥")
    console.log("=" .repeat(60))

    // Deployment configuration
    const baseTokenURI = "https://prophets.zkmarkets.com/metadata/"
    const priceOracle = "0x0000000000000000000000000000000000000000" // Will be set after deployment

    const deployParams: any = [
        baseTokenURI,
        priceOracle
    ]

    console.log("🚀 Deploying ProphetsOfEthereum...")
    console.log(`Base URI: ${baseTokenURI}`)
    console.log(`Price Oracle: ${priceOracle}`)
    console.log(`Network: ${hre.network.name}`)
    console.log(`Total Supply: 666 NFTs`)
    console.log(`Mint Price: 0.01 ETH`)
    console.log(`Maintenance Fee: 1 ETH`)
    console.log("=" .repeat(60))

    try {
        const contract = await deployContract(
            hre,
            "ProphetsOfEthereum",
            deployParams
        )

        console.log("✅ PROPHETS SUCCESSFULLY SUMMONED!")
        console.log("=" .repeat(60))
        console.log(`📋 Contract Address: ${contract.target}`)
        console.log(`🔗 Network: ${hre.network.name}`)
        console.log(`💰 Divine Treasury: 0 ETH (empty at start)`)
        console.log(`👥 Alive Prophets: 0 (none minted yet)`)
        console.log(`📅 Current Week: 1`)
        console.log(`🌙 Blood Moon Phase: Awaiting first ritual`)
        console.log("=" .repeat(60))
        
        console.log("🔮 NEXT STEPS:")
        console.log("1. Call startMinting() to begin the summoning")
        console.log("2. Set up price oracle integration")
        console.log("3. Start the first weekly ritual on Sunday")
        console.log("4. Watch as false prophets burn in divine flames 🔥")
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
    deployProphets(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}