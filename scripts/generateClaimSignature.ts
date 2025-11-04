import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

// Token types enum matching the contract
enum TokenType { ERC20, ERC721, ERC1155, thirdwebERC1155 }

async function createClaimSignature(
  approver: any,
  contract: any,
  user: string,
  tokenContract: string,
  tokenId: number,
  amount: string,
  nonce: number,
  tokenType: number
) {
  const network = await approver.provider.getNetwork();
  const contractAddress = await contract.getAddress();
  
  const domain = {
    name: "TokenClaim",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: contractAddress
  };

  const types = {
    Claim: [
      { name: "user", type: "address" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "tokenType", type: "uint8" }
    ]
  };

  const value = {
    user: user,
    tokenContract: tokenContract,
    tokenId: tokenId,
    amount: amount,
    nonce: nonce,
    tokenType: tokenType
  };

  return await approver.signTypedData(domain, types, value);
}

async function generateClaimSignature() {
  try {
    // Check for help flag
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log(`
📝 TokenClaim Signature Generator

Usage: yarn ts-node scripts/generateClaimSignature.ts [userAddress] [tokenContract] [tokenId] [amount] [nonce] [tokenType] [contractAddress]

Parameters:
  userAddress     - Address of user who will claim tokens
  tokenContract   - Address of the token contract
  tokenId         - Token ID (0 for ERC20, specific ID for ERC721/ERC1155)
  amount          - Amount to claim (for ERC20/ERC1155, should be 1 for ERC721)
  nonce           - Unique nonce (timestamp recommended)
  tokenType       - Token type: 0=ERC20, 1=ERC721, 2=ERC1155, 3=thirdwebERC1155
  contractAddress - Address of deployed TokenClaim contract

Token Types:
  0 - ERC20 (tokenId should be 0)
  1 - ERC721 (amount should be 1)
  2 - ERC1155
  3 - thirdwebERC1155 (calls authorizedMint)

Examples:
  # ERC20 claim
  yarn ts-node scripts/generateClaimSignature.ts 0x123... 0xabc... 0 1000 1234567890 0 0xdef...
  
  # ERC721 claim
  yarn ts-node scripts/generateClaimSignature.ts 0x123... 0xabc... 42 1 1234567890 1 0xdef...
  
  # ERC1155 claim
  yarn ts-node scripts/generateClaimSignature.ts 0x123... 0xabc... 5 10 1234567890 2 0xdef...
`)
      return
    }

    // Get private key from environment
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not found in environment variables")
    }

    // Get network and RPC URL
    const network = getNetwork()
    if (!network || !process.argv.includes("--network")) {
      throw new Error("Network is required. Use --network <network_name>")
    }
    const rpcUrl = getRPC(network)
    const provider = new ethers.JsonRpcProvider(rpcUrl)

    // Create signer from private key
    const signer = new ethers.Wallet(privateKey, provider)
    console.log(`🔑 Signer address: ${signer.address}`)
    console.log(`🌐 Network: ${network}`)
    console.log(`🔗 RPC: ${rpcUrl}`)

    // Get parameters from command line args - all required
    const args = process.argv.slice(2)
    
    if (args.length < 7) {
      throw new Error("All parameters are required: userAddress tokenContract tokenId amount nonce tokenType contractAddress")
    }
    
    let userAddress = args[0]
    let tokenContract = args[1]
    const tokenId = parseInt(args[2])
    const amount = parseInt(args[3])
    const nonce = parseInt(args[4])
    const tokenType = parseInt(args[5])
    let contractAddress = args[6]
    
    // Validate numeric parameters
    if (isNaN(tokenId)) throw new Error("tokenId must be a valid number")
    if (isNaN(amount)) throw new Error("amount must be a valid number")
    if (isNaN(nonce)) throw new Error("nonce must be a valid number")
    if (isNaN(tokenType)) throw new Error("tokenType must be a valid number")
    if (tokenType < 0 || tokenType > 3) throw new Error("tokenType must be 0-3")

    // Validate and normalize addresses
    try {
      userAddress = ethers.getAddress(userAddress)
      tokenContract = ethers.getAddress(tokenContract)
      contractAddress = ethers.getAddress(contractAddress)
    } catch (error) {
      console.error("❌ Invalid address format:", error)
      throw error
    }

    console.log("\n📋 Claim Parameters:")
    console.log(`User Address: ${userAddress}`)
    console.log(`Token Contract: ${tokenContract}`)
    console.log(`Token ID: ${tokenId}`)
    console.log(`Amount: ${amount}`)
    console.log(`Nonce: ${nonce}`)
    console.log(`Token Type: ${TokenType[tokenType]} (${tokenType})`)
    console.log(`Contract: ${contractAddress}`)

    // Create mock contract object with getAddress method
    const mockContract = {
      getAddress: () => Promise.resolve(contractAddress)
    }

    // Use createClaimSignature function
    const signature = await createClaimSignature(
      signer,
      mockContract,
      userAddress,
      tokenContract,
      tokenId,
      amount.toString(),
      nonce,
      tokenType
    )
    
    console.log(`\n✅ Generated EIP-712 Signature: ${signature}`)

    // Output for easy copy-paste
    console.log(`\n📄 claimToken Function Parameters:`)
    console.log(`tokenContract: "${tokenContract}"`)
    console.log(`tokenId: ${tokenId}`)
    console.log(`amount: ${amount}`)
    console.log(`nonce: ${nonce}`)
    console.log(`tokenType: ${tokenType} // ${TokenType[tokenType]}`)
    console.log(`signature: "${signature}"`)

    return {
      userAddress,
      tokenContract,
      tokenId,
      amount,
      nonce,
      tokenType,
      signature,
      signerAddress: signer.address
    }

  } catch (error) {
    console.error("❌ Error generating signature:", error)
    throw error
  }
}

// Interactive version with custom parameters
async function generateClaimSignatureWithParams(params: {
  userAddress: string
  tokenContract: string
  tokenId: number
  amount: number
  nonce: number
  tokenType: TokenType
  contractAddress: string
}) {
  try {
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not found in environment variables")
    }

    const network = getNetwork()
    const rpcUrl = getRPC(network)
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey)
    const chainId = await provider.getNetwork().then(n => Number(n.chainId))

    console.log(`🔑 Signer address: ${signer.address}`)
    console.log(`🌐 Network: ${network}`)

    const domain = {
      name: "TokenClaim",
      version: "1",
      chainId: chainId,
      verifyingContract: params.contractAddress
    }

    const types = {
      Claim: [
        { name: "user", type: "address" },
        { name: "tokenContract", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "tokenType", type: "uint8" }
      ]
    }

    const value = {
      user: params.userAddress,
      tokenContract: params.tokenContract,
      tokenId: params.tokenId,
      amount: params.amount,
      nonce: params.nonce,
      tokenType: params.tokenType
    }

    const signature = await signer.signTypedData(domain, types, value)
    
    console.log(`\n✅ Generated Signature: ${signature}`)
    console.log(`📄 Parameters:`)
    console.log(`- User: ${params.userAddress}`)
    console.log(`- Token: ${params.tokenContract}`)
    console.log(`- TokenId: ${params.tokenId}`)
    console.log(`- Amount: ${params.amount}`)
    console.log(`- Nonce: ${params.nonce}`)
    console.log(`- Type: ${TokenType[params.tokenType]}`)

    return signature

  } catch (error) {
    console.error("❌ Error:", error)
    throw error
  }
}

// Run the script
if (require.main === module) {
  generateClaimSignature()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export { generateClaimSignature, generateClaimSignatureWithParams, createClaimSignature, TokenType }
