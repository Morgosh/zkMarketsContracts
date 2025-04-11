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
  let VRFAddress: string;
  
  if (hre.network.name === "abstract-testnet") {
    // Use the existing NOOT token on testnet
    nootAddress = "0xe3d94b74131f3d831b407fcef76e7b8ee78f8096";
    console.log(`Using existing NOOT token at ${nootAddress} on ${hre.network.name}`);
    
    // Deploy MockVRF for testing purposes
    console.log("Deploying MockVRF...");
    const mockVRF = await deployContract("MockVRF", [], options);
    VRFAddress = await mockVRF.getAddress();
    console.log(`MockVRF deployed at: ${VRFAddress}`);
  } else if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    // For local testing, deploy fresh tokens
    console.log("Deploying on local network, deploying mock NOOT token");
    const mockNoot = await deployContract("ERC20Template", ["NOOT Token", "NOOT"], options);
    nootAddress = await mockNoot.getAddress();
    console.log(`Mock NOOT token deployed at: ${nootAddress}`);
    
    // Deploy MockVRF locally
    console.log("Deploying MockVRF...");
    const mockVRF = await deployContract("MockVRF", [], options);
    VRFAddress = await mockVRF.getAddress();
    console.log(`MockVRF deployed at: ${VRFAddress}`);
  } else {
    throw new Error(`No configuration available for network: ${hre.network.name}. Please update the deployment script.`);
  }
  
  // Game configuration - adjust based on network
  // Using strings instead of BigInt for zkSync deployment compatibility
  const minWager = hre.ethers.parseUnits("100", 18).toString() // 1 NOOT minimum
    
  const maxWager = hre.ethers.parseUnits("1000", 18).toString() // 100 NOOT maximum
  
  console.log(`Configured wager limits: Min=${hre.ethers.formatUnits(minWager, 18)} NOOT, Max=${hre.ethers.formatUnits(maxWager, 18)} NOOT`);
  
  // Deploy NootLadder
  console.log("Deploying NootLadder...");
  const deployParams = [
    nootAddress,    // NOOT token address
    VRFAddress,     // Random provider address
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
  console.log(`VRF Provider: ${VRFAddress}`);
  console.log(`NootLadder: ${nootLadderAddress}`);
  console.log(`Min Wager: ${hre.ethers.formatUnits(minWager, 18)} NOOT`);
  console.log(`Max Wager: ${hre.ethers.formatUnits(maxWager, 18)} NOOT`);
  console.log("-----------------------------");
  
  return {
    nootLadderAddress,
    VRFAddress,
    nootAddress
  };
} 