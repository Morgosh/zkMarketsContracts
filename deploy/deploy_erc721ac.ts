const hre = require("hardhat");
import { deployContract } from "../utils/utils"


async function main() {
  try {
    const options = {
      verify: true,
      doLog: true,
    }

    // Deployment configuration
    const royaltyReceiver = "0x62d8B1c7FE0c8a6d3a8a8Ac051c24A06b4602e65" // Update as needed
    const royaltyFeeNumerator = 1000 // 10% royalty (1000 basis points)
    const name = "Moody Mights"
    const symbol = "CMMM"
    const baseTokenURI = "https://cryptomazeapp.fra1.digitaloceanspaces.com/moodymights/metadata/" // Update as needed
    const approver = "0x62d8B1c7FE0c8a6d3a8a8Ac051c24A06b4602e65" // Update as needed
    const maxSupply = 10000 // Update as needed

    const deployParams: any = [
      royaltyReceiver,
      royaltyFeeNumerator, 
      name,
      symbol,
      baseTokenURI,
      approver,
      maxSupply
    ]

    console.log("🚀 Deploying ERC721ACBasic...")
    console.log(`Name: ${name}`)
    console.log(`Symbol: ${symbol}`)
    console.log(`Royalty Receiver: ${royaltyReceiver}`)
    console.log(`Royalty Fee: ${royaltyFeeNumerator / 100}%`)
    console.log(`Base Token URI: ${baseTokenURI}`)
    console.log(`Approver: ${approver}`)
    console.log(`Max Supply: ${maxSupply}`)
    console.log(`Network: ${hre.network.name}`)

    const contract = await deployContract("ERC721ACBasic", deployParams, options)
    console.log ("done")
    
    const address = await contract.getAddress()
    console.log(`✅ Contract deployed at: ${address}`)
    
    return contract
  } catch (error) {
    console.error("❌ Deployment failed:", error)
    throw error
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });