import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function deployTokenClaim(hre: HardhatRuntimeEnvironment) {
    console.log("🎫 DEPLOYING TOKEN CLAIM CONTRACT 🎫")
    console.log("=" .repeat(60))

    // Deployment configuration
    const approver = "0x62d8B1c7FE0c8a6d3a8a8Ac051c24A06b4602e65" // Default approver address

    const deployParams: any = [
        approver
    ]

    console.log("🚀 Deploying TokenClaim...")
    console.log(`Approver: ${approver}`)
    console.log(`Network: ${hre.network.name}`)
    console.log(`Supported Token Types: ERC20, ERC721, ERC1155, thirdwebERC1155`)
    console.log(`EIP-712 Domain: TokenClaim v1`)
    console.log("=" .repeat(60))

    try {
        const options = {
            verify: true,
            doLog: true,
        }
        const contract = await deployContract(
            "TokenClaim",
            deployParams,
            options
        )

        console.log("✅ TOKEN CLAIM CONTRACT DEPLOYED!")
        console.log("=" .repeat(60))
        console.log(`📋 TokenClaim Contract: ${contract.target}`)
        console.log(`✍️  Approver Address: ${approver}`)
        console.log(`🔗 Network: ${hre.network.name}`)
        console.log(`🎯 Token Types Supported:`)
        console.log(`   - ERC20 (type 0): Transfer existing tokens`)
        console.log(`   - ERC721 (type 1): Transfer existing NFTs`)
        console.log(`   - ERC1155 (type 2): Transfer existing multi-tokens`)
        console.log(`   - thirdwebERC1155 (type 3): Mint new tokens via authorizedMint`)
        console.log("=" .repeat(60))
        
        console.log("🔮 NEXT STEPS:")
        console.log("1. Fund contract with tokens to be claimed (ERC20/721/1155)")
        console.log("2. Grant MINTER_ROLE to this contract for thirdwebERC1155 tokens")
        console.log("3. Configure backend to generate valid signatures")
        console.log("4. Update approver address if needed via setApprover()")
        console.log("5. Test claim functionality with valid signatures")
        console.log("=" .repeat(60))
        
        console.log("🛡️  SECURITY FEATURES:")
        console.log("- EIP-712 signature validation")
        console.log("- Nonce-based replay protection")
        console.log("- Owner-only rescue functions")
        console.log("- Role-based minting for thirdweb tokens")
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
    deployTokenClaim(hre)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
