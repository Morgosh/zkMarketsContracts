// DESCRIPTION
// Admin mint tokens to a specified address
// USAGE
// npx ts-node scripts/adminMint.ts --network sepolia --contract 0x123... --to 0x456... --amount 1 --type erc721

import { getRPC, getNetwork } from "./utils"
import { Wallet, Provider, Contract } from "zksync-ethers"

// Import ABIs
import ERC721TemplateABI from "../abis/ERC721Template.abi.json"
import ERC721MerkleABI from "../abis/ERC721Merkle.abi.json"
import ERC20TemplateABI from "../abis/ERC20Template.abi.json"

const network = getNetwork()
const provider = new Provider(getRPC(network))
const wallet = new Wallet(process.env.PRIVATE_KEY!).connect(provider)

// Parse command line arguments
function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 ? process.argv[index + 1] : undefined
}

function getRequiredArg(name: string): string {
  const value = getArg(name)
  if (!value) {
    throw new Error(`Missing required argument: --${name}`)
  }
  return value
}

async function main() {
  try {
    const contractAddress = getRequiredArg("contract")
    const toAddress = getRequiredArg("to")
    const amount = getRequiredArg("amount")
    const contractType = getArg("type") || "erc721" // default to erc721
    
    console.log(`Running admin mint on network: ${network}`)
    console.log(`Contract: ${contractAddress}`)
    console.log(`To: ${toAddress}`)
    console.log(`Amount: ${amount}`)
    console.log(`Type: ${contractType}`)
    
    // Select appropriate ABI based on type
    let abi
    switch (contractType.toLowerCase()) {
      case "erc721":
      case "erc721template":
        abi = ERC721TemplateABI
        break
      case "erc721merkle":
        abi = ERC721MerkleABI
        break
      case "erc20":
      case "erc20template":
        abi = ERC20TemplateABI
        break
      default:
        throw new Error(`Unsupported contract type: ${contractType}. Use: erc721, erc721merkle, or erc20`)
    }
    
    const contract = new Contract(contractAddress, abi, wallet)
    
    console.log("Sleeping for 2 seconds...")
    await new Promise(r => setTimeout(r, 2000))
    
    // Call adminMint
    console.log("Calling adminMint...")
    const tx = await contract.adminMint(toAddress, amount)
    console.log(`Transaction hash: ${tx.hash}`)
    
    console.log("Waiting for confirmation...")
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block: ${receipt.blockNumber}`)
    
    console.log("Admin mint completed successfully!")
    
  } catch (error) {
    console.error("Error:", error)
    process.exit(1)
  }
}

main() 