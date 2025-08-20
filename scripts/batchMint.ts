// DESCRIPTION
// Batch mint NFTs with gas optimization by grouping consecutive addresses
// USAGE
// npx ts-node scripts/batchMint.ts --network zksync-era --contract 0x123...
// DRY RUN: Add --dry flag (with or without value) to estimate costs without executing

import { getRPC, getNetwork } from "./utils"
import { ethers } from "ethers"
import * as fs from "fs"
import * as path from "path"

// Import ABI
import ERC721ACABI from "../abis/MoodyMightsERC721AC.abi.json"

const network = getNetwork()
const provider = new ethers.JsonRpcProvider(getRPC(network))
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)

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

interface GroupedMint {
  recipient: string
  amount: number
}

interface Batch {
  recipients: string[]
  amounts: number[]
  totalNFTs: number
  startTokenId: number
  endTokenId: number
}

function groupConsecutiveAddresses(owners: OwnerData[]): GroupedMint[] {
  const grouped: GroupedMint[] = []
  
  let currentAddress = owners[0].ownerAddress
  let currentAmount = 1
  
  for (let i = 1; i < owners.length; i++) {
    if (owners[i].ownerAddress.toLowerCase() === currentAddress.toLowerCase()) {
      // Same address, increment amount
      currentAmount++
    } else {
      // Different address, save current group and start new one
      grouped.push({ recipient: currentAddress, amount: currentAmount })
      currentAddress = owners[i].ownerAddress
      currentAmount = 1
    }
  }
  
  // Don't forget the last group
  grouped.push({ recipient: currentAddress, amount: currentAmount })
  
  return grouped
}

function createBatches(grouped: GroupedMint[], maxNFTsPerBatch: number = 25): Batch[] {
  const batches: Batch[] = []
  let currentBatch: Batch = {
    recipients: [],
    amounts: [],
    totalNFTs: 0,
    startTokenId: 0,
    endTokenId: -1
  }
  
  let tokenIdCounter = 0
  
  for (const group of grouped) {
    // Check if adding this group would exceed the batch limit
    if (currentBatch.totalNFTs + group.amount > maxNFTsPerBatch && currentBatch.recipients.length > 0) {
      // Finalize current batch
      currentBatch.endTokenId = tokenIdCounter - 1
      batches.push(currentBatch)
      
      // Start new batch
      currentBatch = {
        recipients: [],
        amounts: [],
        totalNFTs: 0,
        startTokenId: tokenIdCounter,
        endTokenId: -1
      }
    }
    
    // Add group to current batch
    currentBatch.recipients.push(group.recipient)
    currentBatch.amounts.push(group.amount)
    currentBatch.totalNFTs += group.amount
    
    tokenIdCounter += group.amount
  }
  
  // Don't forget the last batch
  if (currentBatch.recipients.length > 0) {
    currentBatch.endTokenId = tokenIdCounter - 1
    batches.push(currentBatch)
  }
  
  return batches
}

async function main() {
  try {
    const contractAddress = getRequiredArg("contract") //0x6c737c0bdb17c410fe8931413c7e420198f07816
    // Check if --dry flag exists (with or without value)
    const dryFlagExists = process.argv.includes("--dry")
    const dryArg = getArg("dry")
    const isDryRun = dryFlagExists
    
    console.log(`🚀 ${isDryRun ? 'DRY RUN - Estimating costs for' : 'Starting'} batch mint on network: ${network}`)
    console.log(`📋 Contract: ${contractAddress}`)
    if (isDryRun) {
      console.log(`🧪 DRY RUN MODE - No actual transactions will be sent (--dry flag detected)`)
    }
    console.log("=".repeat(60))
    
    // Read owners data
    const ownersPath = path.join(__dirname, "ownersId.json")
    if (!fs.existsSync(ownersPath)) {
      throw new Error("ownersId.json not found in scripts directory")
    }
    
    const ownersData: OwnerData[] = JSON.parse(fs.readFileSync(ownersPath, "utf8"))
    console.log(`📁 Loaded ${ownersData.length} token ownership records`)
    
    // Group consecutive addresses
    console.log("🔄 Grouping consecutive addresses...")
    const grouped = groupConsecutiveAddresses(ownersData)
    console.log(`✅ Optimized from ${ownersData.length} individual mints to ${grouped.length} grouped mints`)
    
    // Calculate gas savings
    const gasPerIndividualMint = 50000 // Rough estimate
    const gasPerBatchItem = 30000 // Rough estimate for batch mint per item
    const estimatedGasSaved = (ownersData.length * gasPerIndividualMint) - (grouped.length * gasPerBatchItem)
    console.log(`💡 Estimated gas savings: ~${estimatedGasSaved.toLocaleString()} gas units`)
    
    // Create batches
    console.log("\n📦 Creating batches...")
    const batches = createBatches(grouped, 50) // Safer batch size for many recipients
    console.log(`✅ Created ${batches.length} batches`)
    
    // Show batch breakdown
    batches.forEach((batch, i) => {
      console.log(`   Batch ${i + 1}: ${batch.totalNFTs} NFTs (tokens ${batch.startTokenId}-${batch.endTokenId}) to ${batch.recipients.length} addresses`)
    })
    
    // Create contract instance
    const contract = new ethers.Contract(contractAddress, ERC721ACABI, wallet)
    
    // Get initial balance and gas price for estimates
    const initialBalance = await provider.getBalance(wallet.address)
    const feeData = await provider.getFeeData()
    const gasPrice = feeData.gasPrice || BigInt(0)
    let totalGasUsed = BigInt(0)
    let totalEstimatedGas = BigInt(0)
    
    console.log(`\n💰 Initial ETH balance: ${ethers.formatEther(initialBalance)} ETH`)
    console.log(`⛽ Current gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`)
    console.log(`\n🚀 ${isDryRun ? 'Estimating costs for' : 'Starting'} batch minting...\n`)
    
    // Execute or estimate batches
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      
      console.log(`⏳ ${isDryRun ? 'Estimating' : 'Processing'} batch ${i + 1}/${batches.length}...`)
      console.log(`   📋 ${batch.recipients.length} recipients, ${batch.totalNFTs} total NFTs`)
      console.log(`   🎯 Token IDs: ${batch.startTokenId}-${batch.endTokenId}`)
      
      try {
        // Estimate gas first
        const estimatedGas = await contract.batchMint.estimateGas(batch.recipients, batch.amounts)
        const estimatedEth = estimatedGas * gasPrice
        console.log(`   ⛽ Estimated gas: ${estimatedGas.toLocaleString()}`)
        console.log(`   💸 Estimated ETH: ${ethers.formatEther(estimatedEth)} ETH`)
        
        totalEstimatedGas += estimatedGas
        
        if (isDryRun) {
          // Dry run - just log the estimate
          console.log(`   🧪 DRY RUN: Would mint ${batch.totalNFTs} NFTs to ${batch.recipients.length} addresses`)
          console.log(`   ✅ Batch ${i + 1} estimated successfully!\n`)
        } else {
          // Real run - execute the transaction
          const tx = await contract.batchMint(batch.recipients, batch.amounts)
          console.log(`   📤 Transaction sent: ${tx.hash}`)
          
          // Wait for confirmation
          const receipt = await tx.wait()
          console.log(`   ✅ Confirmed in block: ${receipt.blockNumber}`)
          console.log(`   ⛽ Gas used: ${receipt.gasUsed.toLocaleString()}`)
          console.log(`   💰 Gas price: ${ethers.formatUnits(receipt.gasPrice || 0, "gwei")} gwei`)
          
          const ethUsedForBatch = (receipt.gasUsed * (receipt.gasPrice || BigInt(0)))
          console.log(`   💸 ETH used: ${ethers.formatEther(ethUsedForBatch)} ETH`)
          
          totalGasUsed += receipt.gasUsed
          
          console.log(`   ✅ Batch ${i + 1} completed successfully!\n`)
        }
        
      } catch (error) {
        console.error(`❌ Batch ${i + 1} FAILED!`)
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
        console.error(`\n🛑 STOPPING SCRIPT - Fix the issue and restart from this batch`)
        
        // Show progress so far
        console.log(`\n📊 Progress so far:`)
        console.log(`   ✅ Completed batches: ${i}`)
        if (isDryRun) {
          console.log(`   ⛽ Total estimated gas: ${totalEstimatedGas.toLocaleString()}`)
        } else {
          console.log(`   ⛽ Total gas used: ${totalGasUsed.toLocaleString()}`)
        }
        
        process.exit(1)
      }
      
      // Small delay between batches (only for real runs)
      if (!isDryRun && i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    
    // Final report
    console.log("=".repeat(60))
    if (isDryRun) {
      console.log("🧪 DRY RUN COMPLETED - COST ESTIMATION")
      console.log("=".repeat(60))
      console.log(`📊 Estimated Statistics:`)
      console.log(`   🎯 NFTs to mint: ${ownersData.length}`)
      console.log(`   📦 Total batches: ${batches.length}`)
      console.log(`   ⛽ Total estimated gas: ${totalEstimatedGas.toLocaleString()}`)
      console.log(`   💸 Estimated ETH cost: ${ethers.formatEther(totalEstimatedGas * gasPrice)} ETH`)
      console.log(`   💰 Current balance: ${ethers.formatEther(initialBalance)} ETH`)
      console.log(`   📈 Gas optimization: ${grouped.length} grouped mints vs ${ownersData.length} individual mints`)
      console.log(`   ✅ ${initialBalance >= (totalEstimatedGas * gasPrice) ? 'SUFFICIENT BALANCE' : '⚠️  INSUFFICIENT BALANCE!'}`)
      console.log(`\n🚀 Ready to execute? Remove --dry-run flag to start minting!`)
    } else {
      const finalBalance = await provider.getBalance(wallet.address)
      const totalETHUsed = initialBalance - finalBalance
      
      console.log("🎉 BATCH MINTING COMPLETED SUCCESSFULLY!")
      console.log("=".repeat(60))
      console.log(`📊 Final Statistics:`)
      console.log(`   🎯 Total NFTs minted: ${ownersData.length}`)
      console.log(`   📦 Total batches: ${batches.length}`)
      console.log(`   ⛽ Total gas used: ${totalGasUsed.toLocaleString()}`)
      console.log(`   💸 Total ETH used: ${ethers.formatEther(totalETHUsed)} ETH`)
      console.log(`   💰 Final balance: ${ethers.formatEther(finalBalance)} ETH`)
      console.log(`   📈 Gas optimization: ${grouped.length} grouped mints vs ${ownersData.length} individual mints`)
      console.log(`   🚀 All tokens minted successfully in ascending order!`)
    }
    
  } catch (error) {
    console.error("❌ Fatal Error:", error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main() 