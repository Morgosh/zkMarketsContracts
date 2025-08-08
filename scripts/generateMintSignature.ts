import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

async function generateMintSignature() {
  try {
    // Get private key from environment
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not found in environment variables")
    }

    // Get network and RPC URL
    const network = getNetwork()
    const rpcUrl = getRPC(network)
    const provider = new ethers.JsonRpcProvider(rpcUrl)

    // Create signer from private key
    const signer = new ethers.Wallet(privateKey)
    console.log(`🔑 Signer address: ${signer.address}`)
    console.log(`🌐 Network: ${network}`)
    console.log(`🔗 RPC: ${rpcUrl}`)

    // Hardcoded mint parameters
    const userAddress = "0x3B9daC54B7c841D1EfAe3cA2fA79E6F8473E197B" // User who will mint
    const saleId = 1 // Sale identifier
    // BE EXTRA CAUTIOUS WITH THE END TIME, IT SHOULD BE FIXED NOT DYNAMIC TO PREVENT DUPLICATE SIGNATURES
    const endTime = Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours from now
    const maxMint = 5 // Maximum tokens this user can mint in this sale
    const pricePerToken = ethers.parseEther("0.1") // 0.1 ETH per token
    
    // Contract details for EIP-712
    const contractName = "Moody Mights" // Must match contract name
    const contractVersion = "1" // Must match contract version
    const contractAddress = "0x16dae4ac85f2d5107be4cac6a2d4ae6cb865f1f0" // Update with deployed address
    const chainId = await provider.getNetwork().then(n => Number(n.chainId))

    console.log("\n📋 Mint Parameters:")
    console.log(`User Address: ${userAddress}`)
    console.log(`Sale ID: ${saleId}`)
    console.log(`End Time: ${endTime} (${new Date(endTime * 1000).toISOString()})`)
    console.log(`Max Mint: ${maxMint}`)
    console.log(`Price Per Token: ${ethers.formatEther(pricePerToken)} ETH`)
    console.log(`Contract: ${contractAddress} (Chain: ${chainId})`)

    // EIP-712 Domain
    const domain = {
      name: contractName,
      version: contractVersion,
      chainId: chainId,
      verifyingContract: contractAddress
    }

    // EIP-712 Types
    const types = {
      Mint: [
        { name: "user", type: "address" },
        { name: "saleId", type: "uint256" },
        { name: "endTime", type: "uint256" },
        { name: "maxMint", type: "uint256" },
        { name: "pricePerToken", type: "uint256" }
      ]
    }

    // EIP-712 Value
    const value = {
      user: userAddress,
      saleId: saleId,
      endTime: endTime,
      maxMint: maxMint,
      pricePerToken: pricePerToken.toString()
    }

    console.log(`\n🔒 EIP-712 Domain:`, domain)
    console.log(`🔒 EIP-712 Value:`, value)

    // Sign the typed data
    const signature = await signer.signTypedData(domain, types, value)
    
    console.log(`\n✅ Generated EIP-712 Signature: ${signature}`)

    // Verify signature locally
    const recoveredAddress = ethers.verifyTypedData(domain, types, value, signature)
    console.log(`\n🔍 Signature Verification:`)
    console.log(`Recovered Address: ${recoveredAddress}`)
    console.log(`Matches Signer: ${recoveredAddress.toLowerCase() === signer.address.toLowerCase()}`)

    // Output for easy copy-paste
    console.log(`\n📄 Mint Function Parameters:`)
    console.log(`saleId: ${saleId}`)
    console.log(`endTime: ${endTime}`)
    console.log(`maxMint: ${maxMint}`)
    console.log(`pricePerToken: ${pricePerToken.toString()}`)
    console.log(`amount: 1 // or however many you want to mint`)
    console.log(`signature: "${signature}"`)

    console.log(`\n💰 Required ETH for 1 token: ${ethers.formatEther(pricePerToken)} ETH`)
    console.log(`💰 Required ETH for ${maxMint} tokens: ${ethers.formatEther(pricePerToken * BigInt(maxMint))} ETH`)

    return {
      userAddress,
      saleId,
      endTime,
      maxMint,
      pricePerToken: pricePerToken.toString(),
      signature,
      signerAddress: signer.address,
      domain,
      types,
      value
    }

  } catch (error) {
    console.error("❌ Error generating signature:", error)
    throw error
  }
}

// Run the script
if (require.main === module) {
  generateMintSignature()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export { generateMintSignature }