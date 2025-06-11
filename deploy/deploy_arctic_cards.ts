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
    nootAddress = "0xe3d94b74131f3d831b407fcef76e7b8ee78f8096";
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
  
  const dealerAddress = "0x9a1E4E03fb299F223b37c67691de9461257848b4";
  
  // Game configuration - adjust based on network
  // Using strings instead of BigInt for zkSync deployment compatibility
  const minWager = hre.ethers.parseEther("100").toString()
  const maxWager = hre.ethers.parseEther("10000").toString()
  const minEthWager = hre.ethers.parseEther("0.01").toString() // 0.01 ETH
  const maxEthWager = hre.ethers.parseEther("1").toString() // 1 ETH
  
  console.log(`Configured NOOT wager limits: Min=${hre.ethers.formatUnits(minWager, 18)} NOOT, Max=${hre.ethers.formatUnits(maxWager, 18)} NOOT`);
  console.log(`Configured ETH wager limits: Min=${hre.ethers.formatUnits(minEthWager, 18)} ETH, Max=${hre.ethers.formatUnits(maxEthWager, 18)} ETH`);
  
  // Deploy HigherOrLower
  console.log("Deploying HigherOrLower...");
  const deployParams = [
    nootAddress,    // NOOT token address
    dealerAddress,  // Dealer address (previously trustedSigner)
    minWager,       // Minimum token wager
    maxWager,       // Maximum token wager
    minEthWager,    // Minimum ETH wager
    maxEthWager     // Maximum ETH wager
  ];

  const higherOrLowerContract = await deployContract("HigherOrLower", deployParams, options);
  const higherOrLowerAddress = await higherOrLowerContract.getAddress();
  
  console.log(`HigherOrLower deployed at: ${higherOrLowerAddress}`);
  console.log("-----------------------------");
  console.log("Deployment Summary:");
  console.log(`Network: ${hre.network.name}`);
  console.log(`NOOT Token: ${nootAddress}`);
  console.log(`HigherOrLower: ${higherOrLowerAddress}`);
  console.log(`Dealer Address: ${dealerAddress}`);
  console.log(`Min Token Wager: ${hre.ethers.formatUnits(minWager, 18)} NOOT`);
  console.log(`Max Token Wager: ${hre.ethers.formatUnits(maxWager, 18)} NOOT`);
  console.log(`Min ETH Wager: ${hre.ethers.formatUnits(minEthWager, 18)} ETH`);
  console.log(`Max ETH Wager: ${hre.ethers.formatUnits(maxEthWager, 18)} ETH`);
  console.log("-----------------------------");
  
  return {
    higherOrLowerAddress,
    nootAddress
  };
} 