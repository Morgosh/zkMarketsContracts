import { ethers } from "hardhat";
import hre from "hardhat";

describe("Debug AMM", () => {
  it("should test mock pool directly", async () => {
    const [deployer] = await ethers.getSigners();
    
    // Deploy MockUniswapPool
    const mockPoolArtifact = await hre.artifacts.readArtifact("MockUniswapPool");
    const MockPool = new ethers.ContractFactory(mockPoolArtifact.abi, mockPoolArtifact.bytecode, deployer);
    const mockPool = await MockPool.deploy();
    await mockPool.waitForDeployment();
    
    console.log("Mock pool deployed to:", await mockPool.getAddress());
    
    // Test getReserves
    const [r0, r1, timestamp] = await mockPool.getReserves();
    console.log("Reserves:", r0.toString(), r1.toString(), timestamp.toString());
    
    // Test token addresses
    const t0 = await mockPool.token0();
    const t1 = await mockPool.token1();
    console.log("Tokens:", t0, t1);
    
    // Set a specific price
    const targetPrice = 400000000000n; // $4000 in 1e8
    await mockPool.setPrice(targetPrice);
    
    const [r0_new, r1_new] = await mockPool.getReserves();
    console.log("New reserves:", r0_new.toString(), r1_new.toString());
    
    // Calculate what the price should be
    const calculatedPrice = (BigInt(r1_new) * BigInt(10**18) * BigInt(1e8)) / (BigInt(r0_new) * BigInt(10**6));
    console.log("Calculated price:", calculatedPrice.toString(), "Target:", targetPrice.toString());
  });
});
