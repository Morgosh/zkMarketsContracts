import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    console.log("🖼️  Upload Single Image to Renderer");
    console.log("=" .repeat(60));

    // Configuration constants
    const rendererAddress = "0xcda9cb3CEA3ac21612FF67BBb5E9c1D188c4f2B7"; // UPDATE THIS
    const state = "bullish";
    const imageFile = "03bullish.txt";

    // Validate state
    const validStates = ["prophesizing", "bullish", "bearish", "burned"];
    if (!validStates.includes(state)) {
        console.error(`❌ Invalid state: ${state}`);
        console.log(`Valid states: ${validStates.join(", ")}`);
        process.exit(1);
    }

    console.log(`📋 Configuration:`);
    console.log(`- Renderer: ${rendererAddress}`);
    console.log(`- State: ${state}`);
    console.log(`- Image File: ${imageFile}`);
    console.log("=" .repeat(60));

    // Connect to the renderer contract
    const ProphetsRenderer = await ethers.getContractFactory("ProphetsRenderer");
    const renderer = ProphetsRenderer.attach(rendererAddress);

    // Read image data
    const imagePath = path.join(__dirname, "../deploy/images", imageFile);
    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image file not found: ${imagePath}`);
        process.exit(1);
    }

    const imageData = fs.readFileSync(imagePath, "utf8").trim();
    console.log(`📊 Image Analysis:`);
    console.log(`- Size: ${imageData.length} bytes`);
    console.log(`- Type: ${imageData.substring(0, 30)}...`);
    console.log("=" .repeat(60));

    try {
        // Check if already stored
        console.log("🔍 Checking if image already exists...");
        const existingImage = await renderer.images(state);
        if (existingImage.length > 0) {
            console.log(`❌ Image for state '${state}' already exists!`);
            console.log(`- Existing size: ${existingImage.length} bytes`);
            console.log("💡 Images are write-once only and cannot be overwritten");
            process.exit(1);
        }

        console.log(`✅ State '${state}' is available for upload`);
        console.log("=" .repeat(60));

        // Estimate gas
        console.log("📏 Estimating gas cost...");
        const gasEstimate = await renderer.storeImage.estimateGas(state, imageData);
        console.log(`- Estimated gas: ${gasEstimate.toLocaleString()}`);

        // Get gas price for cost calculation
        const gasPrice = await renderer.runner?.provider?.getFeeData();
        const estimatedCostWei = gasEstimate * (gasPrice?.gasPrice || 0n);
        const estimatedCostETH = parseFloat(ethers.formatEther(estimatedCostWei));

        console.log(`- Estimated cost: ${estimatedCostETH.toFixed(6)} ETH`);
        console.log(`- Estimated cost: $${(estimatedCostETH * 2000).toFixed(2)} USD (at $2000/ETH)`);
        console.log("=" .repeat(60));

        // Upload the image
        console.log(`🚀 Uploading '${state}' image to blockchain...`);
        const tx = await renderer.storeImage(state, imageData);
        console.log(`- Transaction submitted: ${tx.hash}`);
        
        console.log("⏳ Waiting for confirmation...");
        const receipt = await tx.wait();

        if (receipt) {
            const gasUsed = receipt.gasUsed;
            const actualCostWei = gasUsed * (gasPrice?.gasPrice || 0n);
            const actualCostETH = parseFloat(ethers.formatEther(actualCostWei));

            console.log("✅ IMAGE UPLOADED SUCCESSFULLY!");
            console.log("=" .repeat(60));
            console.log(`📋 Upload Details:`);
            console.log(`- State: ${state}`);
            console.log(`- Size: ${imageData.length} bytes`);
            console.log(`- Gas used: ${gasUsed.toLocaleString()}`);
            console.log(`- Actual cost: ${actualCostETH.toFixed(6)} ETH`);
            console.log(`- Actual cost: $${(actualCostETH * 2000).toFixed(2)} USD`);
            console.log(`- Transaction: ${receipt.hash}`);
            console.log(`- Block: ${receipt.blockNumber}`);
            console.log("=" .repeat(60));

            // Verify storage
            console.log("🔍 Verifying storage...");
            const storedImage = await renderer.images(state);
            const success = storedImage === imageData;
            
            console.log(`- Storage verification: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
            console.log(`- Stored size: ${storedImage.length} bytes`);
            
            if (success) {
                console.log("🎉 Image is now permanently stored on-chain!");
                console.log("💎 This image can never be changed or removed");
            }
        }

    } catch (error: any) {
        console.error("❌ Upload failed:", error.message);
        
        if (error.message.includes("already-stored")) {
            console.log("💡 This state already has an image stored");
        } else if (error.message.includes("empty-image")) {
            console.log("💡 The image data appears to be empty");
        } else if (error.message.includes("Ownable: caller is not the owner")) {
            console.log("💡 Only the contract owner can upload images");
        }
        
        process.exit(1);
    }

    console.log("=" .repeat(60));
    console.log("🏁 Upload completed!");
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
