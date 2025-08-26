import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

async function debugContract() {
  try {
    const network = getNetwork()
    const rpcUrl = getRPC(network)
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    
    const contractAddress = "0x47159d83d6bc0b6bb1b11c6fbf69de71aa9e55cb"
    
    // Contract ABI with more functions for debugging
    const contractABI = [
      "function approver() external view returns (address)",
      "function totalSupply() external view returns (uint256)",
      "function name() external view returns (string)",
      "function symbol() external view returns (string)",
      "function TOTAL_SUPPLY() external view returns (uint256)",
      "function mintCompleteTimestamp() external view returns (uint64)",
      "function firstCycleStart() external view returns (uint64)",
      "function renderer() external view returns (address)"
    ]

    const contract = new ethers.Contract(contractAddress, contractABI, provider)
    
    console.log("🔍 CONTRACT DEBUG INFO")
    console.log("=" .repeat(60))
    console.log(`Contract: ${contractAddress}`)
    console.log(`Network: ${network}`)
    console.log(`Chain ID: ${await provider.getNetwork().then(n => Number(n.chainId))}`)
    console.log("=" .repeat(60))
    
    try {
      const name = await contract.name()
      console.log(`✅ Name: "${name}"`)
    } catch (e) {
      console.log(`❌ Name: Failed to read`)
    }
    
    try {
      const symbol = await contract.symbol()
      console.log(`✅ Symbol: "${symbol}"`)
    } catch (e) {
      console.log(`❌ Symbol: Failed to read`)
    }
    
    try {
      const approver = await contract.approver()
      console.log(`✅ Approver: ${approver}`)
    } catch (e) {
      console.log(`❌ Approver: Failed to read - ${e}`)
    }
    
    try {
      const totalSupply = await contract.totalSupply()
      console.log(`✅ Total Supply: ${totalSupply}`)
    } catch (e) {
      console.log(`❌ Total Supply: Failed to read`)
    }
    
    try {
      const maxSupply = await contract.TOTAL_SUPPLY()
      console.log(`✅ Max Supply: ${maxSupply}`)
    } catch (e) {
      console.log(`❌ Max Supply: Failed to read`)
    }
    
    try {
      const renderer = await contract.renderer()
      console.log(`✅ Renderer: ${renderer}`)
    } catch (e) {
      console.log(`❌ Renderer: Failed to read`)
    }
    
    try {
      const mintComplete = await contract.mintCompleteTimestamp()
      console.log(`✅ Mint Complete Timestamp: ${mintComplete}`)
    } catch (e) {
      console.log(`❌ Mint Complete: Failed to read`)
    }
    
    console.log("=" .repeat(60))
    
    // Check your environment variables
    const userPrivateKey = process.env.USER_PRIVATE_KEY || process.env.PRIVATE_KEY
    const approverPrivateKey = process.env.APPROVER_PRIVATE_KEY || process.env.PRIVATE_KEY
    
    if (userPrivateKey) {
      const userWallet = new ethers.Wallet(userPrivateKey)
      console.log(`🔑 Your User Address: ${userWallet.address}`)
    } else {
      console.log(`❌ No USER_PRIVATE_KEY found`)
    }
    
    if (approverPrivateKey) {
      const approverWallet = new ethers.Wallet(approverPrivateKey)
      console.log(`🔑 Your Approver Address: ${approverWallet.address}`)
    } else {
      console.log(`❌ No APPROVER_PRIVATE_KEY found`)
    }
    
    console.log("=" .repeat(60))
    
    // Check if contract approver matches your approver
    try {
      const contractApprover = await contract.approver()
      const approverWallet = new ethers.Wallet(approverPrivateKey || "")
      
      console.log("🔍 APPROVER COMPARISON:")
      console.log(`Contract Approver: ${contractApprover}`)
      console.log(`Your Approver:     ${approverWallet.address}`)
      console.log(`Match: ${contractApprover.toLowerCase() === approverWallet.address.toLowerCase() ? '✅ YES' : '❌ NO'}`)
      
      if (contractApprover.toLowerCase() !== approverWallet.address.toLowerCase()) {
        console.log("")
        console.log("🚨 ISSUE FOUND: Contract approver doesn't match your approver key!")
        console.log("💡 Solutions:")
        console.log("1. Update APPROVER_PRIVATE_KEY in .env to match contract approver")
        console.log("2. Or call setApprover() on contract to update approver address")
      }
    } catch (e) {
      console.log(`❌ Could not compare approvers: ${e}`)
    }
    
  } catch (error: any) {
    console.error("❌ Debug failed:", error.message)
  }
}

if (require.main === module) {
  debugContract()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
