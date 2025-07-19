// DESCRIPTION
// Deploy BasicERC721AC contract with Creator Token Standards
// USAGE
// npx ts-node scripts/deployERC721AC.ts --network sepolia

import { ethers } from "ethers";
import { getRPC, getNetwork } from "./utils";

interface DeploymentConfig {
  name: string;
  symbol: string;
  royaltyReceiver: string;
  royaltyFeeNumerator: number; // In basis points (1000 = 10%)
}

// Update these values for your deployment
const config: DeploymentConfig = {
  name: "My NFT Collection",
  symbol: "MNC",
  royaltyReceiver: "0x0000000000000000000000000000000000000000", // UPDATE THIS!
  royaltyFeeNumerator: 1000 // 10% royalty
};

async function deployContract(): Promise<string> {
  const network = getNetwork();
  const provider = new ethers.JsonRpcProvider(getRPC(network));
  
  // Get wallet from private key
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }
  
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`🔑 Deploying from: ${wallet.address}`);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Wallet balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance === BigInt(0)) {
    throw new Error("Insufficient balance for deployment");
  }

  config.royaltyReceiver = wallet.address;



  console.log("\n📋 DEPLOYMENT CONFIG:");
  console.log("=".repeat(50));
  console.log(`Name: ${config.name}`);
  console.log(`Symbol: ${config.symbol}`);
  console.log(`Royalty Receiver: ${config.royaltyReceiver}`);
  console.log(`Royalty Fee: ${config.royaltyFeeNumerator / 100}%`);
  console.log(`Network: ${network}`);

  if (config.royaltyReceiver === "0x0000000000000000000000000000000000000000") {
    console.warn("⚠️  WARNING: Update royaltyReceiver address before deployment!");
    return "";
  }

  // For now, we'll use a factory pattern or you need to compile with Hardhat
  console.log("\n❌ CONTRACT COMPILATION NEEDED:");
  console.log("This script requires the contract to be compiled first.");
  console.log("\nTo deploy:");
  console.log("1. yarn compile (compile contracts)");
  console.log("2. Update this script with compiled bytecode");
  console.log("3. Or use Hardhat deployment:");
  console.log("   npx hardhat run scripts/deploy.js --network " + network);

  return "";
}

async function updateGasEstimationScript(contractAddress: string) {
  if (!contractAddress) return;
  
  console.log("\n🔄 UPDATING GAS ESTIMATION SCRIPT:");
  console.log(`Contract deployed at: ${contractAddress}`);
  console.log("Update scripts/gasEstimation.ts with the new contract address");
}

async function main() {
  console.log("🚀 ERC721AC Deployment Script");
  console.log("=".repeat(50));

  try {
    const contractAddress = await deployContract();
    
    if (contractAddress) {
      console.log("\n✅ DEPLOYMENT SUCCESSFUL!");
      console.log(`📍 Contract Address: ${contractAddress}`);
      
      await updateGasEstimationScript(contractAddress);
      
      console.log("\n📝 NEXT STEPS:");
      console.log("1. Verify contract on block explorer");
      console.log("2. Update gas estimation script");
      console.log("3. Test minting functions");
      console.log("4. Configure transfer security settings");
    }
    
  } catch (error) {
    console.error("❌ Deployment failed:", error);
  }
}

main().catch(console.error); 