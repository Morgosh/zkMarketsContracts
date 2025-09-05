import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployProphets(hre: HardhatRuntimeEnvironment) {
    console.log("🔥 SUMMONING THE PROPHETS OF ETHEREUM 🔥")
    console.log("=" .repeat(60))

    // Deployment configuration
    const rendererAddr = "0xcda9cb3CEA3ac21612FF67BBb5E9c1D188c4f2B7" // Set to existing renderer address or null to deploy new one
    let uniPool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" // WETH/USDC 0.05% pool on mainnet
    if (hre.network.name === "abstract") {
        uniPool = "0x22E77FfE8d3ee3a161f657F235807caF891F5638"
    }
    const pythContract = "0x8739d5024B5143278E2b15Bd9e7C26f6CEc658F1" // Pyth mainnet
    const approver = "0x01F8540A5e9fA67908273A88A067fE505c99aee8" // Will be set after deployment
    const marketplace = "0x7e0fa00d7a02890c66833d4f08f698d15d4ecd01" // Will be set after deployment (auto-set as operator)

    let renderer: any
    renderer = { target: rendererAddr }

    const deployParams: any = [
        renderer.target,
        uniPool,
        approver,
        marketplace,
        pythContract
    ]

    console.log("🚀 Deploying ProphetsOfEthereum...")
    console.log(`Renderer: ${renderer.target}`)
    console.log(`Uniswap Pool: ${uniPool}`)
    console.log(`Approver: ${approver}`)
    console.log(`Marketplace (auto-operator): ${marketplace}`)
    console.log(`Network: ${hre.network.name}`)
    console.log(`Total Supply: 666 NFTs`)
    console.log(`Mint Price: 0.01 ETH`)
    console.log(`Maintenance Fee: 1 ETH`)
    console.log("=" .repeat(60))

    try {
        const options = {
            verify: true,
            doLog: true,
          }
        const contract = await deployContract(
            "ProphetsOfEthereum",
            deployParams,
            options
        )

        console.log("✅ PROPHETS SUCCESSFULLY SUMMONED!")
        console.log("=" .repeat(60))
        console.log(`📋 Prophets Contract: ${contract.target}`)
        console.log(`🎨 Renderer Contract: ${renderer.target}`)
        console.log(`🔗 Network: ${hre.network.name}`)
        console.log(`💰 Divine Treasury: 0 ETH (empty at start)`)
        console.log(`👥 Alive Prophets: 0 (none minted yet)`)
        console.log(`📅 Current Week: 1`)
        console.log(`🌙 Blood Moon Phase: Awaiting first ritual`)
        console.log("=" .repeat(60))
        
        console.log("🔮 NEXT STEPS:")
        console.log("1. Set approver address for signature minting")
        console.log("2. Set marketplace address for listing punishment")
        console.log("3. Configure Pyth price feed settings if needed")
        console.log("4. Start minting and begin the first weekly ritual on Sunday")
        console.log("5. Watch as false prophets burn in divine flames 🔥")
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