import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployLilPudgyStrategy(hre: HardhatRuntimeEnvironment) {
    console.log("💰 DEPLOYING LIL PUDGY STRATEGY TOKEN 💰")
    console.log("=" .repeat(60))

    console.log("🚀 Deploying LilPudgyStrategy...")
    console.log(`Network: ${hre.network.name}`)
    console.log("=" .repeat(60))

    try {
        const options = {
            verify: true,
            doLog: true,
          }

        // Token parameters
        const name = "LilPudgyStrategy"
        const symbol = "LILPDGYSTR"
        const initialSupply = "1000000000000000000000000000" // 1 billion tokens (1e9 * 1e18)
        const treasury = "0x485e402fB5Da2Eb1115FD2814DE3b1C469D13797"
        const devWallet = "0x50a5eb671D80CedcCC8879caF8f07b95367eB1C9"
        
        // Router address - using Abstract mainnet router
        const router = "0xad1eCa41E6F772bE3cb5A48A6141f9bcc1AF9F7c"

        const contract = await deployContract(
            "V2FeeToken",
            [name, symbol, initialSupply, treasury, devWallet, router],
            options
        )

        console.log("✅ LIL PUDGY STRATEGY SUCCESSFULLY DEPLOYED!")
        console.log("=" .repeat(60))
        console.log(`📋 Token Address: ${contract.target}`)
        console.log(`🔗 Network: ${hre.network.name}`)
        console.log(`💰 Initial Supply: 1,000,000,000 tokens`)
        console.log(`🏦 Treasury: ${treasury}`)
        console.log(`👨‍💻 Dev Wallet: ${devWallet}`)
        console.log(`📊 Fee: 10% (configurable)`)
        console.log(`🔄 Split: 80% treasury / 20% dev`)
        console.log("=" .repeat(60))
        
        console.log("🔮 NEXT STEPS:")
        console.log("1. Call enableTrading() to start trading")
        console.log("2. Add liquidity to the created pair")
        console.log("3. Configure limits if needed")
        console.log("=" .repeat(60))
        
        console.log("📝 ENVIRONMENT VARIABLE:")
        console.log(`export LILPUDGY_TOKEN_ADDRESS=${contract.target}`)
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
    deployLilPudgyStrategy(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
