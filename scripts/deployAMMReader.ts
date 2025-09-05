import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));
    
    // ETH/USDC V2 pool on mainnet
    const ethUsdcPool = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
    
    console.log("Deploying AMMPriceReader with ETH/USDC pool:", ethUsdcPool);
    
    const AMMPriceReader = await ethers.getContractFactory("AMMPriceReader");
    const reader = await AMMPriceReader.deploy(ethUsdcPool);
    
    console.log("Waiting for deployment...");
    await reader.waitForDeployment();
    
    const address = await reader.getAddress();
    console.log("AMMPriceReader deployed to:", address);
    
    // Wait a bit for the contract to be indexed
    console.log("Waiting for contract to be ready...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
        console.log("Testing contract...");
        
        // Get pool info
        const poolInfo = await reader.getPoolInfo();
        console.log("\n=== Pool Info ===");
        console.log(`Token0: ${poolInfo[0]} (${poolInfo[2]}) - ${poolInfo[4]} decimals`);
        console.log(`Token1: ${poolInfo[1]} (${poolInfo[3]}) - ${poolInfo[5]} decimals`);
        console.log(`Reserve0: ${poolInfo[6].toString()}`);
        console.log(`Reserve1: ${poolInfo[7].toString()}`);
        
        // Get debug calculation
        const debug = await reader.debugCalculation();
        console.log("\n=== Debug Calculation ===");
        console.log(`r0: ${debug[0].toString()}`);
        console.log(`r1: ${debug[1].toString()}`);
        console.log(`d0: ${debug[2]}`);
        console.log(`d1: ${debug[3]}`);
        console.log(`num: ${debug[4].toString()}`);
        console.log(`den: ${debug[5].toString()}`);
        console.log(`price1e8: ${debug[6].toString()}`);
        console.log(`finalPrice: ${debug[7].toString()}`);
        
        // Read the actual price
        const price = await reader.readAMMPrice();
        console.log("\n=== Final Result ===");
        console.log(`Raw Price: ${price.toString()}`);
        console.log(`Formatted Price: $${(Number(price) / 1e8).toFixed(2)}`);
        
        if (price.toString() === "0") {
            console.log("\n⚠️  WARNING: Price is 0! Check the debug info above.");
        } else {
            console.log("\n✅ Success! AMM price reading is working.");
        }
        
    } catch (error) {
        console.error("Error testing contract:", error);
    }
    
    console.log(`\n📝 Contract deployed at: ${address}`);
    console.log("You can interact with it using this address.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
