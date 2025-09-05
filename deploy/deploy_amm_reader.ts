import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Deploying AMMPriceReader...");
  
  // ETH/USDC V2 pool on mainnet
  let uniPool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" // WETH/USDC 0.05% pool on mainnet
  if (hre.network.name === "abstract") {
      uniPool = "0x22E77FfE8d3ee3a161f657F235807caF891F5638"
  }

  const deployment = await deploy("AMMPriceReader", {
    from: deployer,
    args: [uniPool],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`AMMPriceReader deployed at: ${deployment.address}`);
  
  // Get contract instance
  const reader = await ethers.getContractAt("AMMPriceReader", deployment.address);
  
  try {
    // Test reading the pool info
    const poolInfo = await reader.getPoolInfo();
    console.log("Pool Info:");
    console.log(`  Token0: ${poolInfo[0]} (${poolInfo[2]}) - ${poolInfo[4]} decimals`);
    console.log(`  Token1: ${poolInfo[1]} (${poolInfo[3]}) - ${poolInfo[5]} decimals`);
    console.log(`  Reserve0: ${poolInfo[6].toString()}`);
    console.log(`  Reserve1: ${poolInfo[7].toString()}`);
    
    // Test reading the price
    const price = await reader.readAMMPrice();
    console.log(`AMM Price: ${price.toString()}`);
    console.log(`AMM Price (formatted): $${(Number(price) / 1e8).toFixed(2)}`);
    
    // Get debug info
    const debug = await reader.debugCalculation();
    console.log("Debug Calculation:");
    console.log(`  Numerator: ${debug[4].toString()}`);
    console.log(`  Denominator: ${debug[5].toString()}`);
    console.log(`  Price 1e8: ${debug[6].toString()}`);
    
  } catch (error) {
    console.error("Error testing contract:", error);
  }
};

func.tags = ["AMMPriceReader"];
export default func;
