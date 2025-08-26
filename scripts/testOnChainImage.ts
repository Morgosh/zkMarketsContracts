import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    console.log("🧪 Testing On-Chain Image Storage Gas Costs");
    console.log("=" .repeat(60));

    // Read the prophesizing image data
    const imagePath = path.join(__dirname, "../deploy/images/01prophesizing.txt");
    const imageData = fs.readFileSync(imagePath, "utf8").trim();
    
    console.log(`📊 Image Data Analysis:`);
    console.log(`- Size: ${imageData.length} characters`);
    console.log(`- Size: ${Buffer.from(imageData).length} bytes`);
    console.log(`- Type: ${imageData.substring(0, 30)}...`);
    console.log("=" .repeat(60));

    // Deploy test contract
    console.log("🚀 Deploying OnChainImageTest contract...");
    const OnChainImageTest = await ethers.getContractFactory("OnChainImageTest");
    const contract = await OnChainImageTest.deploy();
    await contract.waitForDeployment();
    
    const contractAddress = await contract.getAddress();
    console.log(`✅ Contract deployed at: ${contractAddress}`);
    console.log("=" .repeat(60));

    // Get gas price info
    const [deployer] = await ethers.getSigners();
    const provider = deployer.provider;
    const gasPrice = await provider.getFeeData();
    
    console.log(`⛽ Gas Price Info:`);
    console.log(`- Gas Price: ${ethers.formatUnits(gasPrice.gasPrice || 0n, "gwei")} gwei`);
    console.log(`- Max Fee: ${ethers.formatUnits(gasPrice.maxFeePerGas || 0n, "gwei")} gwei`);
    console.log("=" .repeat(60));

    try {
        // Estimate gas for storing the image
        console.log("📏 Estimating gas for storeImage...");
        const gasEstimate = await contract.storeImage.estimateGas("prophesizing", imageData);
        console.log(`- Estimated Gas: ${gasEstimate.toLocaleString()} gas`);
        
        // Calculate costs
        const gasPriceWei = gasPrice.gasPrice || 0n;
        const estimatedCostWei = gasEstimate * gasPriceWei;
        const estimatedCostETH = ethers.formatEther(estimatedCostWei);
        
        console.log(`- Estimated Cost: ${estimatedCostETH} ETH`);
        console.log(`- Estimated Cost: $${(parseFloat(estimatedCostETH) * 2000).toFixed(4)} USD (at $2000/ETH)`);
        console.log("=" .repeat(60));
        
        // Actually store the image to get real gas usage
        console.log("💾 Actually storing image to measure real gas usage...");
        const tx = await contract.storeImage("prophesizing", imageData);
        const receipt = await tx.wait();
        
        if (receipt) {
            const actualGasUsed = receipt.gasUsed;
            const actualCostWei = actualGasUsed * gasPriceWei;
            const actualCostETH = ethers.formatEther(actualCostWei);
            
            console.log(`✅ Image stored successfully!`);
            console.log(`- Transaction Hash: ${receipt.hash}`);
            console.log(`- Actual Gas Used: ${actualGasUsed.toLocaleString()} gas`);
            console.log(`- Actual Cost: ${actualCostETH} ETH`);
            console.log(`- Actual Cost: $${(parseFloat(actualCostETH) * 2000).toFixed(4)} USD (at $2000/ETH)`);
            console.log("=" .repeat(60));
            
            // Test retrieval
            console.log("📖 Testing image retrieval...");
            const retrievedImage = await contract.getImage("prophesizing");
            const matches = retrievedImage === imageData;
            
            console.log(`- Retrieved successfully: ${matches ? '✅' : '❌'}`);
            console.log(`- Retrieved size: ${retrievedImage.length} characters`);
            console.log("=" .repeat(60));
            
            // Cost analysis
            console.log("💰 Cost Analysis:");
            console.log(`- Cost per byte: ${(parseFloat(actualCostETH) / imageData.length * 1e9).toFixed(4)} gwei/byte`);
            console.log(`- For 4 images (prophesizing, bullish, bearish, burned):`);
            console.log(`  - Total gas: ~${(actualGasUsed * 4n).toLocaleString()} gas`);
            console.log(`  - Total cost: ~${(parseFloat(actualCostETH) * 4).toFixed(6)} ETH`);
            console.log(`  - Total cost: ~$${(parseFloat(actualCostETH) * 4 * 2000).toFixed(2)} USD`);
            console.log("=" .repeat(60));
            
            // Recommendations
            console.log("📋 Recommendations:");
            if (parseFloat(actualCostETH) > 0.01) {
                console.log("❌ On-chain storage is EXPENSIVE for images");
                console.log("✅ Recommend using IPFS or external hosting");
                console.log("✅ Use renderer contract with configurable baseImageURI");
            } else if (parseFloat(actualCostETH) > 0.001) {
                console.log("⚠️  On-chain storage is moderately expensive");
                console.log("💡 Consider trade-offs: decentralization vs cost");
            } else {
                console.log("✅ On-chain storage is relatively affordable");
                console.log("💎 Could consider on-chain for full decentralization");
            }
        }
        
    } catch (error: any) {
        console.error("❌ Error during gas estimation or execution:");
        console.error(error.message);
        
        // Try to get more info about why it failed
        if (error.message.includes("out of gas")) {
            console.log("💡 The image might be too large to store on-chain");
        }
    }
    
    console.log("=" .repeat(60));
    console.log("🏁 Test completed!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
