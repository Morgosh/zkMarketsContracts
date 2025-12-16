import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

// Token types enum matching the contract
enum TokenType { ERC20, ERC721, ERC1155, thirdwebERC1155 }

async function createClaimSignature(
  signer: ethers.Wallet,
  contractAddress: string,
  chainId: number,
  user: string,
  tokenContract: string,
  tokenId: number,
  amount: number,
  nonce: number,
  tokenType: number,
  value: bigint = 0n
) {
  const domain = {
    name: "TokenClaim",
    version: "1",
    chainId,
    verifyingContract: contractAddress
  }

  const types = {
    Claim: [
      { name: "user", type: "address" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "tokenType", type: "uint8" },
      { name: "value", type: "uint256" }
    ]
  }

  const message = { user, tokenContract, tokenId, amount, nonce, tokenType, value }

  console.log("message", message, "domain", domain, "types", types)

  return signer.signTypedData(domain, types, message)
}

async function generateClaimSignature() {
  try {
    // Check for help flag
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log(`
📝 TokenClaim Signature Generator

Usage: yarn ts-node scripts/generateClaimSignature.ts --network <network> --userAddress <addr> --tokenContract <addr> --tokenId <id> --nonce <nonce> --tokenType <type> --contractAddress <addr> [--amount <amt>]

Required:
  --network         Network name (e.g. abstract-testnet, abstract)
  --userAddress     Address of user who will claim tokens
  --tokenContract   Address of the token contract
  --tokenId         Token ID (0 for ERC20, specific ID for ERC721/ERC1155)
  --nonce           Unique nonce (timestamp recommended)
  --tokenType       0=ERC20, 1=ERC721, 2=ERC1155, 3=thirdwebERC1155
  --contractAddress Address of deployed TokenClaim contract

Optional:
  --amount          Amount to claim (default: 1)
  --value           ETH value in wei (default: 0)

Example:
  yarn ts-node scripts/generateClaimSignature.ts --network abstract-testnet --userAddress 0x123... --tokenContract 0xabc... --tokenId 1 --nonce 69 --tokenType 3 --contractAddress 0xdef...
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
    const chainId = Number((await provider.getNetwork()).chainId)
    console.log(`🔑 Signer address: ${signer.address}`)
    console.log(`🌐 Network: ${network} (chainId: ${chainId})`)
    console.log(`🔗 RPC: ${rpcUrl}`)

    // Parse named arguments
    const getArg = (name: string): string | undefined => {
      const idx = process.argv.indexOf(`--${name}`)
      return idx !== -1 ? process.argv[idx + 1] : undefined
    }

    let userAddress = getArg('userAddress')
    let tokenContract = getArg('tokenContract')
    const tokenIdStr = getArg('tokenId')
    const amountStr = getArg('amount') ?? '1'
    const nonceStr = getArg('nonce')
    const tokenTypeStr = getArg('tokenType')
    let contractAddress = getArg('contractAddress')
    const valueStr = getArg('value') ?? '0'

    if (!userAddress || !tokenContract || !tokenIdStr || !nonceStr || !tokenTypeStr || !contractAddress) {
      throw new Error("Required: --userAddress --tokenContract --tokenId --nonce --tokenType --contractAddress")
    }

    const tokenId = parseInt(tokenIdStr)
    const amount = parseInt(amountStr)
    const nonce = parseInt(nonceStr)
    const tokenType = parseInt(tokenTypeStr)
    const value = BigInt(valueStr)
    
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
    console.log(`Value: ${value}`)

    const signature = await createClaimSignature(
      signer,
      contractAddress,
      chainId,
      userAddress,
      tokenContract,
      tokenId,
      amount,
      nonce,
      tokenType,
      value
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
  value?: bigint
}) {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) throw new Error("PRIVATE_KEY not found")

  const network = getNetwork()
  const provider = new ethers.JsonRpcProvider(getRPC(network))
  const signer = new ethers.Wallet(privateKey)
  const chainId = Number((await provider.getNetwork()).chainId)

  console.log(`🔑 Signer: ${signer.address}`)
  console.log(`🌐 Network: ${network}`)

  const signature = await createClaimSignature(
    signer,
    params.contractAddress,
    chainId,
    params.userAddress,
    params.tokenContract,
    params.tokenId,
    params.amount,
    params.nonce,
    params.tokenType,
    params.value ?? 0n
  )
  
  console.log(`\n✅ Signature: ${signature}`)
  return signature
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
