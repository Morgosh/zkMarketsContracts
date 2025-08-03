const hre = require("hardhat");
import { deployContract } from "../utils/utils"


async function main() {
  try {
    const options = {
      verify: true,
      doLog: true,
    }

    // Deployment configuration
    const royaltyReceiver = "0x8F995E8961D2FF09d444aB4eC72d67f36aa2c8CC" // Update as needed
    const royaltyFeeNumerator = 1000 // 10% royalty (1000 basis points)
    const name = "Moody Mights"
    const symbol = "CMMM"
    const baseTokenURI = "https://cryptomazeapp.fra1.digitaloceanspaces.com/moodymights/metadata/" // Update as needed

    const deployParams: any = [
      royaltyReceiver,
      royaltyFeeNumerator, 
      name,
      symbol,
      baseTokenURI
    ]

    console.log("🚀 Deploying ERC721ACBasic...")
    console.log(`Name: ${name}`)
    console.log(`Symbol: ${symbol}`)
    console.log(`Royalty Receiver: ${royaltyReceiver}`)
    console.log(`Royalty Fee: ${royaltyFeeNumerator / 100}%`)
    console.log(`Base Token URI: ${baseTokenURI}`)
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