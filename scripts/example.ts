// DESCRIPTION
// Example script template
// USAGE
// npx ts-node scripts/example.ts --network sepolia

import { getRPC, getNetwork } from "./utils"
import { Wallet, Provider, Contract } from "zksync-ethers"

const network = getNetwork()
const provider = new Provider(getRPC(network))
const wallet = new Wallet(process.env.PRIVATE_KEY!).connect(provider)

// Example contract interaction
// const contractAddress = "0x..." // Add your contract address
// const contractABI = require("../abis/YourContract.abi.json")
// const contract = new Contract(contractAddress, contractABI, wallet)

doIt()

async function doIt() {
  console.log(`Running on network: ${network}`)
  console.log(`Wallet address: ${wallet.address}`)
  
  // Sleep for a moment
  console.log("Sleeping for 2 seconds...")
  await new Promise(r => setTimeout(r, 2000))
  
  try {
    // Example: Get wallet balance
    const balance = await wallet.getBalance()
    console.log(`Wallet balance: ${balance.toString()} ETH`)
    
    // Add your contract interactions here
    // const tx = await contract.yourMethod(params)
    // await tx.wait()
    
    console.log("Script completed successfully!")
  } catch (error) {
    console.error("Error:", error)
  }
} 