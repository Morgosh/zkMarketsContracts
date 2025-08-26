import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    console.log("🎨 Uploading Prophet Images to Renderer Contract");
    console.log("=" .repeat(60));

    // Get the renderer contract address (you'll need to update this)
    const rendererAddress = process.env.RENDERER_ADDRESS;
    if (!rendererAddress) {
        console.error("❌ Please set RENDERER_ADDRESS environment variable");
        process.exit(1);
    }

    // Connect to the renderer contract
    const ProphetsRenderer = await ethers.getContractFactory("ProphetsRenderer");
    const renderer = ProphetsRenderer.attach(rendererAddress);
    
    console.log(`📋 Renderer Contract: ${rendererAddress}`);
    console.log("=" .repeat(60));

    // Image mappings
    const imageFiles = [
        { state: "prophesizing", file: "01prophesizing.txt" },
        { state: "bullish", file: "02bullish.txt" },
        { state: "bearish", file: "03bearish.txt" },
        { state: "burned", file: "04burned.txt" }
    ];

    let totalGasUsed = 0n;
    let totalCost = 0;

    for (const { state, file } of imageFiles) {
        console.log(`🖼️  Processing ${state} image...`);
        
        // Read image data
        const imagePath = path.join(__dirname, "../deploy/images", file);
        if (!fs.existsSync(imagePath)) {
            console.log(`⚠️  File not found: ${file}, skipping...`);
            continue;
        }
        
        const imageData = fs.readFileSync(imagePath, "utf8").trim();
        console.log(`- Size: ${imageData.length} bytes`);
        
        try {
            // Check if already stored
            const existingImage = await renderer.images(state);
            if (existingImage.length > 0) {
                console.log(`✅ ${state} already stored, skipping...`);
                continue;
            }
            
            // Estimate gas
            const gasEstimate = await renderer.storeImage.estimateGas(state, imageData);
            console.log(`- Estimated gas: ${gasEstimate.toLocaleString()}`);
            
            // Store the image
            console.log(`- Uploading ${state} image...`);
            const tx = await renderer.storeImage(state, imageData);
            const receipt = await tx.wait();
            
            if (receipt) {
                const gasUsed = receipt.gasUsed;
                totalGasUsed += gasUsed;
                
                // Get gas price for cost calculation
                const gasPrice = await renderer.runner?.provider?.getFeeData();
                const costWei = gasUsed * (gasPrice?.gasPrice || 0n);
                const costETH = parseFloat(ethers.formatEther(costWei));
                totalCost += costETH;
                
                console.log(`✅ ${state} uploaded successfully!`);
                console.log(`- Gas used: ${gasUsed.toLocaleString()}`);
                console.log(`- Cost: ${costETH.toFixed(6)} ETH`);
                console.log(`- TX: ${receipt.hash}`);
            }
            
        } catch (error: any) {
            console.error(`❌ Failed to upload ${state}:`, error.message);
        }
        
        console.log("-" .repeat(40));
    }
    
    console.log("=" .repeat(60));
    console.log("📊 Upload Summary:");
    console.log(`- Total gas used: ${totalGasUsed.toLocaleString()}`);
    console.log(`- Total cost: ${totalCost.toFixed(6)} ETH`);
    console.log(`- Total cost: $${(totalCost * 2000).toFixed(2)} USD (at $2000/ETH)`);
    console.log("=" .repeat(60));
    
    // Test retrieval
    console.log("🧪 Testing image retrieval...");
    for (const { state } of imageFiles) {
        try {
            const storedImage = await renderer.images(state);
            if (storedImage.length > 0) {
                console.log(`✅ ${state}: ${storedImage.length} bytes stored`);
            } else {
                console.log(`❌ ${state}: not found`);
            }
        } catch (error) {
            console.log(`❌ ${state}: error retrieving`);
        }
    }
    
    console.log("=" .repeat(60));
    console.log("🏁 Upload completed!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
