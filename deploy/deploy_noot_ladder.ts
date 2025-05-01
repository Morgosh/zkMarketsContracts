import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function (hre: HardhatRuntimeEnvironment) {
  const options = {
    verify: true,
    doLog: true,
  }

  console.log(`Deploying contracts to network: ${hre.network.name}`)

  // Get deployed NOOT token address based on network
  let nootAddress: string;
  
  if (hre.network.name === "abstract-testnet") {
    // Use the existing NOOT token on testnet
    nootAddress = "0x3d8b869eB751B63b7077A0A93D6b87a54e6C8f56";
    console.log(`Using existing NOOT token at ${nootAddress} on ${hre.network.name}`);
    
  } else if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    // For local testing, deploy fresh tokens
    console.log("Deploying on local network, deploying mock NOOT token");
    const mockNoot = await deployContract("ERC20Template", ["NOOT Token", "NOOT"], options);
    nootAddress = await mockNoot.getAddress();
    console.log(`Mock NOOT token deployed at: ${nootAddress}`);
  } else {
    throw new Error(`No configuration available for network: ${hre.network.name}. Please update the deployment script.`);
  }
  
  const trustedSigner = "0x9a1E4E03fb299F223b37c67691de9461257848b4";
  // Game configuration - adjust based on network
  // Using strings instead of BigInt for zkSync deployment compatibility
  const minWager = hre.ethers.parseEther("100").toString()
  const maxWager = hre.ethers.parseEther("10000").toString()
  
  console.log(`Configured wager limits: Min=${hre.ethers.formatUnits(minWager, 18)} NOOT, Max=${hre.ethers.formatUnits(maxWager, 18)} NOOT`);
  
  // Deploy NootLadder
  console.log("Deploying NootLadder...");
  const deployParams = [
    nootAddress,    // NOOT token address
    trustedSigner,  // Trusted signer address
    minWager,       // Minimum wager as string
    maxWager        // Maximum wager as string
  ];

  const nootLadderContract = await deployContract("NootLadder", deployParams, options);
  const nootLadderAddress = await nootLadderContract.getAddress();
  
  console.log(`NootLadder deployed at: ${nootLadderAddress}`);
  console.log("-----------------------------");
  console.log("Deployment Summary:");
  console.log(`Network: ${hre.network.name}`);
  console.log(`NOOT Token: ${nootAddress}`);
  console.log(`NootLadder: ${nootLadderAddress}`);
  console.log(`Min Wager: ${hre.ethers.formatUnits(minWager, 18)} NOOT`);
  console.log(`Max Wager: ${hre.ethers.formatUnits(maxWager, 18)} NOOT`);
  console.log("-----------------------------");
  
  return {
    nootLadderAddress,
    nootAddress
  };
} 