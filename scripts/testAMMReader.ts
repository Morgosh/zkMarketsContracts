import { ethers } from "hardhat";

async function main() {
    console.log("Deploying AMMPriceReader...");
    
    // Deploy with zero address first, we'll set the pool later
    const AMMPriceReader = await ethers.getContractFactory("AMMPriceReader");
    const reader = await AMMPriceReader.deploy(ethers.ZeroAddress);
    await reader.waitForDeployment();
    
    console.log("AMMPriceReader deployed to:", await reader.getAddress());
    
    // Common ETH/USDC pairs on different networks
    const pools = {
        mainnet: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", // ETH/USDC V2
        sepolia: "0x...", // Add if you know one
        // For testing, we can use any address that implements the interface
    };
    
    // Test with mainnet pool (if on mainnet fork)
    const poolAddress = pools.mainnet;
    
    try {
        await reader.setPool(poolAddress);
        console.log("Pool set to:", poolAddress);
        
        // Get pool info
        const poolInfo = await reader.getPoolInfo();
        console.log("Pool Info:");
        console.log("  Token0:", poolInfo[0], poolInfo[2], "Decimals:", poolInfo[4]);
        console.log("  Token1:", poolInfo[1], poolInfo[3], "Decimals:", poolInfo[5]);
        console.log("  Reserve0:", poolInfo[6].toString());
        console.log("  Reserve1:", poolInfo[7].toString());
        
        // Get debug calculation
        const debug = await reader.debugCalculation();
        console.log("Debug Calculation:");
        console.log("  r0:", debug[0].toString());
        console.log("  r1:", debug[1].toString());
        console.log("  d0:", debug[2]);
        console.log("  d1:", debug[3]);
        console.log("  num:", debug[4].toString());
        console.log("  den:", debug[5].toString());
        console.log("  price1e8:", debug[6].toString());
        console.log("  finalPrice:", debug[7].toString());
        
        // Try to read price
        const price = await reader.readAMMPrice();
        console.log("AMM Price:", price.toString());
        console.log("AMM Price (formatted):", (Number(price) / 1e8).toFixed(2));
        
    } catch (error) {
        console.log("Error reading from pool:", error);
        console.log("This is expected if the pool address doesn't exist on this network");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
