// DESCRIPTION
// Verify token ownership against zkSync chain
// USAGE
// npx ts-node scripts/verifyOwnership.ts --network zksync-era --contract 0x123...

import { getRPC, getNetwork } from "./utils"
import { Wallet, Provider, Contract } from "zksync-ethers"
import * as fs from "fs"
import * as path from "path"

// Import ABI - using ERC721Template as it has ownerOf function
import ERC721ABI from "../abis/ERC721Template.abi.json"

const network = getNetwork()
const provider = new Provider(getRPC(network))

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

interface OwnerData {
  tokenId: string
  ownerAddress: string
}

async function main() {
  try {
    const contractAddress = getRequiredArg("contract")
    
    console.log(`🔍 Verifying token ownership on network: ${network}`)
    console.log(`📋 Contract: ${contractAddress}`)
    console.log("=" .repeat(50))
    
    // Read owners data
    const ownersPath = path.join(__dirname, "ownersId.json")
    if (!fs.existsSync(ownersPath)) {
      throw new Error("ownersId.json not found in scripts directory")
    }
    
    const ownersData: OwnerData[] = JSON.parse(fs.readFileSync(ownersPath, "utf8"))
    console.log(`📁 Loaded ${ownersData.length} token ownership records`)
    
    // Create contract instance (read-only, no wallet needed)
    const contract = new Contract(contractAddress, ERC721ABI, provider)
    
    let matches = 0
    let mismatches = 0
    let errors = 0
    
    console.log("\n🚀 Starting verification...\n")
    
    // Process each token one by one
    for (let i = 0; i < ownersData.length; i++) {
      const { tokenId, ownerAddress } = ownersData[i]
      
      try {
        // Call ownerOf on the contract
        const actualOwner = await contract.ownerOf(tokenId)
        
        // Compare addresses (case insensitive)
        if (actualOwner.toLowerCase() === ownerAddress.toLowerCase()) {
          console.log(`✅ Token ${tokenId}: MATCH (${ownerAddress})`)
          matches++
        } else {
          console.log(`❌ Token ${tokenId}: MISMATCH`)
          console.log(`   Expected: ${ownerAddress}`)
          console.log(`   Actual:   ${actualOwner}`)
          mismatches++
        }
        
        // Progress indicator
        if ((i + 1) % 100 === 0 || i === ownersData.length - 1) {
          console.log(`\n📊 Progress: ${i + 1}/${ownersData.length} tokens checked`)
          console.log(`   ✅ Matches: ${matches}`)
          console.log(`   ❌ Mismatches: ${mismatches}`)
          console.log(`   🚫 Errors: ${errors}\n`)
        }
        
      } catch (error) {
        console.log(`🚫 Token ${tokenId}: ERROR - ${error instanceof Error ? error.message : String(error)}`)
        errors++
      }
      
      // Small delay to avoid overwhelming the RPC
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Final report
    console.log("\n" + "=".repeat(50))
    console.log("📋 FINAL REPORT")
    console.log("=".repeat(50))
    console.log(`Total tokens checked: ${ownersData.length}`)
    console.log(`✅ Matches: ${matches}`)
    console.log(`❌ Mismatches: ${mismatches}`)
    console.log(`🚫 Errors: ${errors}`)
    console.log(`📊 Success rate: ${((matches / ownersData.length) * 100).toFixed(2)}%`)
    
    if (mismatches === 0 && errors === 0) {
      console.log("\n🎉 All tokens verified successfully!")
    } else if (mismatches > 0) {
      console.log(`\n⚠️  Found ${mismatches} ownership mismatches!`)
    }
    
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main() 