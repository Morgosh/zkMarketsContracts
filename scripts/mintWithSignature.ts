import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

async function mintWithSignature() {
  try {
    // Get private key from environment (for the user who will mint)
    const userPrivateKey = process.env.USER_PRIVATE_KEY || process.env.PRIVATE_KEY
    if (!userPrivateKey) {
      throw new Error("USER_PRIVATE_KEY not found in environment variables")
    }

    // Get approver private key for signature generation
    const approverPrivateKey = process.env.APPROVER_PRIVATE_KEY || process.env.PRIVATE_KEY
    if (!approverPrivateKey) {
      throw new Error("APPROVER_PRIVATE_KEY not found in environment variables")
    }

    // Get network and RPC URL
    const network = getNetwork()
    if (!network) {
      throw new Error("Network not specified or detected")
    }
    
    const rpcUrl = getRPC(network)
    if (!rpcUrl) {
      throw new Error(`No RPC URL found for network: ${network}`)
    }
    
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    
    // Test provider connection
    try {
      await provider.getNetwork()
    } catch (error) {
      throw new Error(`Failed to connect to network provider at ${rpcUrl}. Check your network connection and RPC URL.`)
    }

    // Create signers
    const userWallet = new ethers.Wallet(userPrivateKey, provider)
    const approverWallet = new ethers.Wallet(approverPrivateKey)

    console.log(`🔑 User address: ${userWallet.address}`)
    console.log(`🔑 Approver address: ${approverWallet.address}`)
    console.log(`🌐 Network: ${network}`)
    console.log(`🔗 RPC: ${rpcUrl}`)

    // Contract configuration - UPDATE THESE VALUES
    const contractAddress = "0x10282e513e506a0ece732c18c6ddc84d8ae9ac54" // Update with deployed contract
    const chainId = await provider.getNetwork().then(n => Number(n.chainId))

    // Mint parameters
    const saleId = 1
    // BE EXTRA CAUTIOUS WITH THE END TIME, IT SHOULD BE FIXED NOT DYNAMIC TO PREVENT DUPLICATE SIGNATURES
    const endTime = Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours from now
    const maxMint = 1
    const pricePerToken = ethers.parseEther("0.01")
    const amountToMint = 10 // How many tokens to mint

    console.log("\n📋 Mint Parameters:")
    console.log(`Contract: ${contractAddress}`)
    console.log(`Chain ID: ${chainId}`)
    console.log(`Sale ID: ${saleId}`)
    console.log(`End Time: ${endTime} (${new Date(endTime * 1000).toISOString()})`)
    console.log(`Max Mint: ${maxMint}`)
    console.log(`Price Per Token: ${ethers.formatEther(pricePerToken)} ETH`)
    console.log(`Amount to Mint: ${amountToMint}`)

    // Create contract instance
    const contractABI = [
      "function mint(uint256 saleId, uint256 endTime, uint256 maxMint, uint256 pricePerToken, uint256 amount, bytes calldata signature) external payable",
      "function totalSupply() external view returns (uint256)",
      "function balanceOf(address owner) external view returns (uint256)",
      "function approver() external view returns (address)",
      "function maxSupply() external view returns (uint256)",
      "function name() external view returns (string)"
    ]

    const contract = new ethers.Contract(contractAddress, contractABI, userWallet)

    // Get contract name for EIP-712 domain
    const contractName = await contract.name()
    console.log(`📋 Contract name: "${contractName}"`)

    // Verify contract approver matches our approver
    try {
      const contractApprover = await contract.approver()
      if (contractApprover.toLowerCase() !== approverWallet.address.toLowerCase()) {
        throw new Error(`Contract approver (${contractApprover}) doesn't match provided approver (${approverWallet.address})`)
      }
      console.log(`✅ Approver verification passed`)
    } catch (error: any) {
      throw new Error(`Failed to verify contract approver: ${error.message}`)
    }

    // Generate EIP-712 signature
    console.log("\n🔒 Generating EIP-712 signature...")

    const domain = {
      name: contractName,
      version: "1",
      chainId: chainId,
      verifyingContract: contractAddress
    }

    const types = {
      Mint: [
        { name: "user", type: "address" },
        { name: "saleId", type: "uint256" },
        { name: "endTime", type: "uint256" },
        { name: "maxMint", type: "uint256" },
        { name: "pricePerToken", type: "uint256" }
      ]
    }

    const value = {
      user: userWallet.address,
      saleId: saleId,
      endTime: endTime,
      maxMint: maxMint,
      pricePerToken: pricePerToken.toString()
    }

    const signature = await approverWallet.signTypedData(domain, types, value)
    console.log(`✅ Signature generated: ${signature}`)

    // Calculate required ETH
    const totalCost = pricePerToken * BigInt(amountToMint)
    console.log(`\n💰 Total cost: ${ethers.formatEther(totalCost)} ETH`)

    // Check user balance
    const userBalance = await provider.getBalance(userWallet.address)
    console.log(`💰 User balance: ${ethers.formatEther(userBalance)} ETH`)

    if (userBalance < totalCost) {
      throw new Error(`Insufficient balance. Need ${ethers.formatEther(totalCost)} ETH, have ${ethers.formatEther(userBalance)} ETH`)
    }

    // Get current supply before minting
    const supplyBefore = await contract.totalSupply()
    const userBalanceBefore = await contract.balanceOf(userWallet.address)

    console.log(`\n📊 Before minting:`)
    console.log(`Total supply: ${supplyBefore}`)
    console.log(`User balance: ${userBalanceBefore} tokens`)

    // Estimate gas
    try {
      const gasEstimate = await contract.mint.estimateGas(
        saleId,
        endTime,
        maxMint,
        pricePerToken,
        amountToMint,
        signature,
        { value: totalCost }
      )
      console.log(`⛽ Estimated gas: ${gasEstimate}`)
    } catch (error: any) {
      console.log(`⚠️  Gas estimation failed: ${error.message}`)
      throw new Error(`Transaction will likely fail. Gas estimation error: ${error.message}`)
    }

    // Execute mint transaction
    console.log(`\n🚀 Executing mint transaction...`)

    const tx = await contract.mint(
      saleId,
      endTime,
      maxMint,
      pricePerToken,
      amountToMint,
      signature,
      { 
        value: totalCost,
        gasLimit: 500000 // Set reasonable gas limit
      }
    )

    console.log(`📝 Transaction hash: ${tx.hash}`)
    console.log(`⏳ Waiting for confirmation...`)

    const receipt = await tx.wait()
    
    if (receipt.status === 1) {
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)
      console.log(`⛽ Gas used: ${receipt.gasUsed}`)

      // Get updated balances
      const supplyAfter = await contract.totalSupply()
      const userBalanceAfter = await contract.balanceOf(userWallet.address)

      console.log(`\n📊 After minting:`)
      console.log(`Total supply: ${supplyAfter} (+${supplyAfter - supplyBefore})`)
      console.log(`User balance: ${userBalanceAfter} tokens (+${userBalanceAfter - userBalanceBefore})`)

      console.log(`\n🎉 Successfully minted ${amountToMint} token(s)!`)
    } else {
      throw new Error("Transaction failed")
    }

  } catch (error: any) {
    console.error("\n❌ Mint failed:")
    
    // Provide descriptive error messages
    if (error.message.includes("Sale has ended")) {
      console.error("💀 The sale has expired. Check the endTime parameter.")
    } else if (error.message.includes("Exceeds max supply")) {
      console.error("💀 Not enough tokens left in the collection.")
    } else if (error.message.includes("Insufficient payment")) {
      console.error("💀 Incorrect ETH amount sent. Check pricePerToken calculation.")
    } else if (error.message.includes("Invalid signature")) {
      console.error("💀 Signature validation failed. Check approver key and parameters.")
    } else if (error.message.includes("Exceeds max mint")) {
      console.error("💀 You've reached the maximum mint limit for this sale.")
    } else if (error.message.includes("Amount must be greater than 0")) {
      console.error("💀 Cannot mint 0 tokens.")
    } else if (error.message.includes("insufficient funds")) {
      console.error("💀 Insufficient ETH balance to cover transaction cost + gas.")
    } else if (error.message.includes("nonce too low")) {
      console.error("💀 Transaction nonce issue. Try again in a few seconds.")
    } else if (error.message.includes("gas")) {
      console.error("💀 Gas related error. Transaction may be too complex or gas price too low.")
    } else if (error.code === "NETWORK_ERROR") {
      console.error("💀 Network connection error. Check your RPC URL.")
    } else if (error.code === "CALL_EXCEPTION") {
      console.error("💀 Contract call failed. Check contract address and ABI.")
    } else {
      console.error(`💀 Unexpected error: ${error.message}`)
    }
    
    throw error
  }
}

// Run the script
if (require.main === module) {
  mintWithSignature()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export { mintWithSignature }