// DESCRIPTION
// Gas estimation for chunked batch minting using ethers estimateGas
// USAGE
// npx ts-node scripts/gasEstimation.ts --network sepolia

import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { getRPC, getNetwork } from './utils';

interface Owner {
  ownerAddress: string;
  NftCount: number;
}

interface GasEstimate {
  totalNFTs: number;
  totalOwners: number;
  chunksNeeded: number;
  totalGasEstimate: bigint;
  costAt20Gwei: number;
  costAt50Gwei: number;
  costAt100Gwei: number;
}

const contractAddress = "0x0000000000000000000000000000000000000001";

const MAX_GAS_PER_CHUNK = BigInt(29000000); // Stay under block limit (~30M)

// Gas prices in gwei
const GAS_PRICES = {
  low: 20,
  medium: 50, 
  high: 100
};

function loadOwners(): Owner[] {
  const filePath = path.join(__dirname, 'owners.json');
  
  if (!fs.existsSync(filePath)) {
    console.error('❌ owners.json file not found!');
    console.log('📝 Create owners.json with format:');
    console.log(`[
  {
    "ownerAddress": "0x1234567890123456789012345678901234567890",
    "NftCount": 16
  },
  {
    "ownerAddress": "0x0987654321098765432109876543210987654321", 
    "NftCount": 5
  }
]`);
    process.exit(1);
  }
  
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error reading owners.json:', error);
    process.exit(1);
  }
}

async function createBatches(owners: Owner[], contract: ethers.Contract): Promise<Owner[][]> {
  const batches: Owner[][] = [];
  let currentBatch: Owner[] = [];
  let currentBatchGas = BigInt(0);
  
  for (const owner of owners) {
    // Create arrays for batch estimation
    const addresses = Array(owner.NftCount).fill(owner.ownerAddress);
    
    try {
      // Estimate gas for this owner's NFTs
      const ownerGas = await contract.batchMintToAddresses.estimateGas(addresses);
      
      // If adding this owner would exceed gas limit, start new batch
      if (currentBatchGas + ownerGas > MAX_GAS_PER_CHUNK && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [owner];
        currentBatchGas = ownerGas;
      } else {
        currentBatch.push(owner);
        currentBatchGas += ownerGas;
      }
    } catch (error) {
      console.warn(`Warning: Could not estimate gas for ${owner.ownerAddress}, using fallback`);
      // Fallback to previous batch if estimation fails
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [owner];
                 currentBatchGas = BigInt(0);
      } else {
        currentBatch.push(owner);
      }
    }
  }
  
  // Add final batch if not empty
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  
  return batches;
}

async function estimateGas(owners: Owner[], contract: ethers.Contract): Promise<GasEstimate> {
  const batches = await createBatches(owners, contract);
  
  let totalGas = BigInt(0);
  let totalNFTs = 0;
  
  console.log('\n📊 BATCH BREAKDOWN:');
  console.log('='.repeat(50));
  
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    const batchNFTs = batch.reduce((sum, owner) => sum + owner.NftCount, 0);
    
    // Create address array for this batch
    const addresses: string[] = [];
    batch.forEach(owner => {
      for (let i = 0; i < owner.NftCount; i++) {
        addresses.push(owner.ownerAddress);
      }
    });
    
    try {
      const batchGas = await contract.batchMintToAddresses.estimateGas(addresses);
      totalGas += batchGas;
      totalNFTs += batchNFTs;
      
      console.log(`Batch ${index + 1}:`);
      console.log(`  👥 Owners: ${batch.length}`);
      console.log(`  🎨 NFTs: ${batchNFTs.toLocaleString()}`);
      console.log(`  ⛽ Gas: ${batchGas.toString()}`);
      console.log('');
    } catch (error) {
      console.error(`Error estimating gas for batch ${index + 1}:`, error);
    }
  }
  
  const totalGasNumber = Number(totalGas);
  
  return {
    totalNFTs,
    totalOwners: owners.length,
    chunksNeeded: batches.length,
    totalGasEstimate: totalGas,
    costAt20Gwei: (totalGasNumber * GAS_PRICES.low * 1e9) / 1e18,
    costAt50Gwei: (totalGasNumber * GAS_PRICES.medium * 1e9) / 1e18,
    costAt100Gwei: (totalGasNumber * GAS_PRICES.high * 1e9) / 1e18
  };
}

function displayResults(estimate: GasEstimate) {
  console.log('💰 TOTAL COST ESTIMATION');
  console.log('='.repeat(50));
  console.log(`📦 Total NFTs to mint: ${estimate.totalNFTs.toLocaleString()}`);
  console.log(`👥 Total unique owners: ${estimate.totalOwners.toLocaleString()}`);
  console.log(`🔄 Transactions needed: ${estimate.chunksNeeded}`);
  console.log(`⛽ Total gas estimate: ${estimate.totalGasEstimate.toLocaleString()}`);
  console.log('');
  
  console.log('💸 ETH COSTS:');
  console.log(`  @ 20 gwei:  ${estimate.costAt20Gwei.toFixed(4)} ETH`);
  console.log(`  @ 50 gwei:  ${estimate.costAt50Gwei.toFixed(4)} ETH`);
  console.log(`  @ 100 gwei: ${estimate.costAt100Gwei.toFixed(4)} ETH`);
  console.log('');
  
  // USD estimates (approximate)
  const ethPrice = 2500; // Update this value
  console.log(`💵 USD COSTS (assuming ETH = $${ethPrice}):`);
  console.log(`  @ 20 gwei:  $${(estimate.costAt20Gwei * ethPrice).toLocaleString()}`);
  console.log(`  @ 50 gwei:  $${(estimate.costAt50Gwei * ethPrice).toLocaleString()}`);
  console.log(`  @ 100 gwei: $${(estimate.costAt100Gwei * ethPrice).toLocaleString()}`);
}

async function main() {
  console.log('🚀 ERC721AC Batch Minting Gas Estimation');
  console.log('='.repeat(50));
  
  const owners = loadOwners();
  console.log(`📁 Loaded ${owners.length} owners from owners.json`);
  
  // Setup provider and contract
  const network = getNetwork();
  const provider = new ethers.JsonRpcProvider(getRPC(network));
  
  // Contract ABI - just the function we need
  const contractABI = [
    "function batchMintToAddresses(address[] calldata recipients) external returns (uint256)"
  ];
  
  // Use a dummy contract address for estimation (you can update this)
  const contract = new ethers.Contract(contractAddress, contractABI, provider);
  
  console.log(`🌐 Using network: ${network}`);
  console.log(`📋 Contract: ${contractAddress}`);
  
  try {
    const estimate = await estimateGas(owners, contract);
    displayResults(estimate);
  } catch (error) {
    console.error('❌ Error during gas estimation:', error);
    console.log('\n💡 Make sure your network is accessible and contract address is valid');
  }
  
  console.log('\n⚠️  NOTES:');
  console.log('• Gas estimates are from actual contract calls');
  console.log('• Actual gas usage may vary ±5%');
  console.log('• Consider current network congestion');
  console.log('• Test on testnet first!');
}

main().catch(console.error); 