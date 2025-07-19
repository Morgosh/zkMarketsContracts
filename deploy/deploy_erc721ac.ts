import { ethers, parseEther } from "ethers"
import { generatePrivateKeyWithSalt } from "../functions"
import * as dotenv from "dotenv"

dotenv.config({ path: ".env" })

async function main() {
  console.log("🚀 Deploying BasicERC721AC...")
  console.log("=".repeat(50))

  // Get deployer private key
  const deployerKey = process.env.PRIVATE_KEY ?? generatePrivateKeyWithSalt("test")
  
  // Connect to network (you can modify this for different networks)
  const provider = new ethers.JsonRpcProvider("https://sepolia.era.zksync.dev") // Change as needed
  const deployer = new ethers.Wallet(deployerKey, provider)

  // Deployment configuration
  const config = {
    name: "My NFT Collection",
    symbol: "MNC", 
    royaltyReceiver: deployer.address,
    royaltyFeeNumerator: 1000 // 10% royalty (1000 basis points)
  }

  console.log(`Name: ${config.name}`)
  console.log(`Symbol: ${config.symbol}`)
  console.log(`Royalty Receiver: ${config.royaltyReceiver}`)
  console.log(`Royalty Fee: ${config.royaltyFeeNumerator / 100}%`)
  console.log(`Deployer: ${deployer.address}`)

  // Check deployer balance
  const balance = await provider.getBalance(deployer.address)
  console.log(`💰 Deployer balance: ${ethers.formatEther(balance)} ETH`)

  if (balance < parseEther("0.01")) {
    throw new Error("Insufficient balance for deployment (need at least 0.01 ETH)")
  }

  console.log("\n🚀 DEPLOYING CONTRACT...")
  
  try {
    // For now, we'll deploy a simple contract as example
    // You need to add the BasicERC721AC contract to your contracts folder first
    
    // Simple deployment example (you'll need to compile BasicERC721AC first)
    console.log("❌ Contract not compiled yet!")
    console.log("Add BasicERC721AC.sol to contracts/ folder and run:")
    console.log("1. yarn compile")
    console.log("2. Then this script will work")
    
    // Uncomment when contract is compiled:
    // const contractFactory = await ethers.getContractFactory("BasicERC721AC")
    // const contract = await contractFactory.connect(deployer).deploy(
    //   config.name,
    //   config.symbol,
    //   config.royaltyReceiver,
    //   config.royaltyFeeNumerator
    // )
    // await contract.waitForDeployment()
    // const address = await contract.getAddress()
    // console.log(`✅ Contract deployed at: ${address}`)
    // return address
    
  } catch (error) {
    console.error("❌ Deployment failed:", error)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}) 