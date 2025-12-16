import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

enum TokenType { ERC20, ERC721, ERC1155, thirdwebERC1155 }

const TOKEN_CLAIM_ABI = [
  "function claimToken(address tokenContract, uint256 tokenId, uint256 amount, uint256 nonce, uint8 tokenType, bytes signature) external payable"
]

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
  return signer.signTypedData(domain, types, message)
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
📝 TokenClaim Signature Generator + Mint

Usage: yarn ts-node scripts/generateClaimSignatureAndMint.ts --network <network> --userAddress <addr> --tokenContract <addr> --tokenId <id> --nonce <nonce> --tokenType <type> --contractAddress <addr> [--amount <amt>] [--value <wei>]

Required:
  --network         Network name (e.g. abstract-testnet, abstract)
  --userAddress     Address of user who will claim tokens  
  --tokenContract   Address of the token contract
  --tokenId         Token ID (0 for ERC20, specific ID for ERC721/ERC1155)
  --nonce           Unique nonce
  --tokenType       0=ERC20, 1=ERC721, 2=ERC1155, 3=thirdwebERC1155
  --contractAddress Address of deployed TokenClaim contract

Optional:
  --amount          Amount to claim (default: 1)
  --value           ETH value in wei (default: 0)

Example:
  yarn ts-node scripts/generateClaimSignatureAndMint.ts --network abstract-testnet --userAddress 0x123... --tokenContract 0xabc... --tokenId 1 --nonce 69 --tokenType 3 --contractAddress 0xdef...
`)
    return
  }

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) throw new Error("PRIVATE_KEY not found")

  const network = getNetwork()
  if (!process.argv.includes("--network")) throw new Error("--network required")
  
  const rpcUrl = getRPC(network)
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const signer = new ethers.Wallet(privateKey, provider)
  const chainId = Number((await provider.getNetwork()).chainId)

  console.log(`🔑 Signer: ${signer.address}`)
  console.log(`🌐 Network: ${network} (chainId: ${chainId})`)

  const getArg = (name: string): string | undefined => {
    const idx = process.argv.indexOf(`--${name}`)
    return idx !== -1 ? process.argv[idx + 1] : undefined
  }

  const userAddress = ethers.getAddress(getArg('userAddress') ?? '')
  const tokenContract = ethers.getAddress(getArg('tokenContract') ?? '')
  const contractAddress = ethers.getAddress(getArg('contractAddress') ?? '')
  const tokenId = parseInt(getArg('tokenId') ?? '')
  const amount = parseInt(getArg('amount') ?? '1')
  const nonce = parseInt(getArg('nonce') ?? '')
  const tokenType = parseInt(getArg('tokenType') ?? '')
  const value = BigInt(getArg('value') ?? '0')

  if (isNaN(tokenId) || isNaN(amount) || isNaN(nonce) || isNaN(tokenType)) {
    throw new Error("Required: --userAddress --tokenContract --tokenId --nonce --tokenType --contractAddress")
  }
  if (tokenType < 0 || tokenType > 3) throw new Error("tokenType must be 0-3")

  console.log(`\n📋 Claim: tokenId=${tokenId}, amount=${amount}, nonce=${nonce}, type=${TokenType[tokenType]}, value=${value}`)

  const signature = await createClaimSignature(
    signer, contractAddress, chainId, userAddress, tokenContract, tokenId, amount, nonce, tokenType, value
  )
  console.log(`✅ Signature: ${signature}`)

  // Call claimToken
  const contract = new ethers.Contract(contractAddress, TOKEN_CLAIM_ABI, signer)
  console.log(`\n🚀 Calling claimToken...`)
  
  const tx = await contract.claimToken(tokenContract, tokenId, amount, nonce, tokenType, signature, { value })
  console.log(`📤 TX: ${tx.hash}`)
  
  const receipt = await tx.wait()
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`)
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1) })
}

export { createClaimSignature, TokenType }

