import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

async function checkApprover() {
  const network = getNetwork()
  const rpcUrl = getRPC(network)
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  
  const contractAddress = "0xe959E0bc3caD7267bB8B47FBb3E2aD8f12561489"
  
  // Simple ABI for the approver function
  const abi = [
    "function approver() view returns (address)"
  ]
  
  const contract = new ethers.Contract(contractAddress, abi, provider)
  
  try {
    const approver = await contract.approver()
    console.log(`Contract: ${contractAddress}`)
    console.log(`Current approver: ${approver}`)
    console.log(`Your signer: 0x50a5eb671D80CedcCC8879caF8f07b95367eB1C9`)
    console.log(`Match: ${approver.toLowerCase() === "0x50a5eb671D80CedcCC8879caF8f07b95367eB1C9".toLowerCase()}`)
  } catch (error) {
    console.error("Error checking approver:", error)
  }
}

checkApprover()

