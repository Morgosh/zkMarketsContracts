import { ethers } from "ethers"
import * as dotenv from "dotenv"
import { getRPC, getNetwork } from "./utils"

dotenv.config()

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getTargetTime(): Date {
  const now = new Date()
  
  // Target: 15:00 UTC (3:00 PM UTC)
  const target = new Date()
  target.setUTCHours(15, 0, 0, 0) // 3:00 PM UTC
  
  // If target time has passed today, set for tomorrow
  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1)
  }
  
  return target
}

function calculateOptimalInterval(currentSupply: number, maxSupply: number, targetTime: Date): number {
  const now = new Date()
  const timeRemaining = targetTime.getTime() - now.getTime()
  const tokensRemaining = maxSupply - currentSupply
  
  if (tokensRemaining <= 0) return 0
  if (timeRemaining <= 0) return 1000 // minimum 1 second
  
  const optimalInterval = timeRemaining / tokensRemaining
  
  // Enforce minimum 1 second
  return Math.max(1000, optimalInterval)
}

function formatTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }) + ' CET'
}

async function loopMint() {
  let mintCount = 0
  const startTime = Date.now()
  
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
    const endTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days from now
    const maxMint = 666 // Allow minting up to max supply
    const pricePerToken = ethers.parseEther("0.00")
    const amountToMint = 1 // Always mint 1 at a time

    console.log("\n📋 Loop Mint Parameters:")
    console.log(`Contract: ${contractAddress}`)
    console.log(`Chain ID: ${chainId}`)
    console.log(`Sale ID: ${saleId}`)
    console.log(`End Time: ${endTime} (${new Date(endTime * 1000).toISOString()})`)
    console.log(`Max Mint: ${maxMint}`)
    console.log(`Price Per Token: ${ethers.formatEther(pricePerToken)} ETH`)
    console.log(`Amount per mint: ${amountToMint}`)
    console.log(`Mint interval: 1 minute`)

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

    // EIP-712 domain setup
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

    // Generate signature once (since parameters don't change)
    const signature = await approverWallet.signTypedData(domain, types, value)
    console.log(`✅ Signature generated: ${signature}`)

    // Get initial state
    const maxSupply = await contract.maxSupply()
    const currentSupply = await contract.totalSupply()
    const tokensRemaining = Number(maxSupply) - Number(currentSupply)
    
    console.log(`📊 Max supply: ${maxSupply}`)
    console.log(`📊 Current supply: ${currentSupply}`)
    console.log(`🎫 Tokens remaining: ${tokensRemaining}`)
    
    if (tokensRemaining <= 0) {
      console.log(`🎯 Collection is already sold out!`)
      return
    }
    
    // Calculate target time and initial timing
    const targetTime = getTargetTime()
    const timeRemaining = targetTime.getTime() - Date.now()
    const initialInterval = Math.max(5000, timeRemaining / tokensRemaining)
    
    console.log(`🎯 Target completion: ${formatTime(targetTime)}`)
    console.log(`⏰ Current time: ${formatTime(new Date())}`)
    console.log(`⏱️  Time until target: ${Math.round(timeRemaining / 1000 / 60)} minutes`)
    console.log(`📈 Initial optimal interval: ${Math.round(initialInterval / 1000)} seconds per mint`)

    console.log(`\n🔄 Starting adaptive loop mint... Press Ctrl+C to stop\n`)

    // Main loop
    while (true) {
      let shouldContinue = true
      try {
        const currentTime = new Date()
        console.log(`\n⏰ [${formatTime(currentTime)}] Attempting mint #${mintCount + 1}...`)

        // Check current supply before each attempt
        const currentSupply = await contract.totalSupply()
        const tokensRemaining = Number(maxSupply) - Number(currentSupply)
        const progress = (Number(currentSupply) / Number(maxSupply)) * 100
        
        console.log(`📊 Supply: ${currentSupply}/${maxSupply} (${progress.toFixed(1)}% complete)`)
        console.log(`🎫 Tokens remaining: ${tokensRemaining}`)
        
        // Calculate optimal timing based on remaining tokens
        const optimalInterval = calculateOptimalInterval(Number(currentSupply), Number(maxSupply), targetTime)
        const timeRemaining = targetTime.getTime() - currentTime.getTime()
        
        console.log(`⏱️  Time until target: ${Math.round(timeRemaining / 1000 / 60)} minutes`)
        console.log(`📈 Optimal interval: ${Math.round(optimalInterval / 1000)} seconds`)
        
        if (timeRemaining <= 0 && tokensRemaining > 0) {
          console.log(`⚠️  Target time has passed! Minting at minimum 1-second intervals.`)
        }

        if (currentSupply >= maxSupply) {
          console.log(`🎯 Max supply reached! Collection is sold out.`)
          shouldContinue = false
        } else {
          // Check user balance
          const userBalance = await provider.getBalance(userWallet.address)
          const totalCost = pricePerToken * BigInt(amountToMint)
          
          console.log(`💰 User balance: ${ethers.formatEther(userBalance)} ETH`)
          console.log(`💰 Cost: ${ethers.formatEther(totalCost)} ETH`)

          if (userBalance < totalCost) {
            console.log(`❌ Insufficient balance. Need ${ethers.formatEther(totalCost)} ETH`)
            shouldContinue = false
          } else {
            // Estimate gas first
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
              console.log(`❌ Gas estimation failed: ${error.message}`)
              shouldContinue = false
            }

            if (shouldContinue) {
              // Execute mint transaction
              console.log(`🚀 Executing mint...`)
              const tx = await contract.mint(
                saleId,
                endTime,
                maxMint,
                pricePerToken,
                amountToMint,
                signature,
                { 
                  value: totalCost,
                  gasLimit: 500000
                }
              )

              mintCount++
              console.log(`📝 Tx hash: ${tx.hash}`)
              console.log(`🚀 Mint #${mintCount} submitted! (not waiting for confirmation)`)
            }
          }
        }

      } catch (error: any) {
        console.log(`\n❌ Mint #${mintCount + 1} failed:`)
        
        // Handle specific errors
        if (error.message.includes("Sale has ended")) {
          console.log("💀 Sale has expired")
        } else if (error.message.includes("Exceeds max supply")) {
          console.log("💀 Max supply reached")
        } else if (error.message.includes("Insufficient payment")) {
          console.log("💀 Incorrect payment amount")
        } else if (error.message.includes("Invalid signature")) {
          console.log("💀 Invalid signature")
        } else if (error.message.includes("Exceeds max mint")) {
          console.log("💀 Max mint limit reached")
        } else if (error.message.includes("insufficient funds")) {
          console.log("💀 Insufficient funds")
        } else {
          console.log(`💀 Unexpected error: ${error.message}`)
        }
        
        // Set flag to stop continuing
        shouldContinue = false
      } finally {
        // Only wait if we're continuing to next iteration
        if (shouldContinue) {
          // Recalculate optimal interval in case supply changed during mint
          const currentSupply = await contract.totalSupply()
          const optimalInterval = calculateOptimalInterval(Number(currentSupply), Number(maxSupply), targetTime)
          const waitTime = Math.max(1000, optimalInterval) // minimum 1 second
          
          console.log(`⏱️  Waiting ${Math.round(waitTime / 1000)} seconds before next mint...`)
          console.log(`🕐 Next mint at: ${formatTime(new Date(Date.now() + waitTime))}`)
          await sleep(waitTime)
        }
      }
      
      // Break out of loop if we should stop
      if (!shouldContinue) {
        break
      }
    }

  } catch (error: any) {
    console.error(`\n💥 Script setup failed: ${error.message}`)
  } finally {
    const endTime = Date.now()
    const duration = Math.round((endTime - startTime) / 1000)
    const finalTime = new Date()
    const targetTime = getTargetTime()
    const timeDiff = finalTime.getTime() - targetTime.getTime()
    
    console.log(`\n📊 Final Stats:`)
    console.log(`🎫 Total mints: ${mintCount}`)
    console.log(`⏱️  Duration: ${duration} seconds`)
    console.log(`💰 Total spent: ${ethers.formatEther(ethers.parseEther("0.00") * BigInt(mintCount))} ETH`)
    console.log(`🎯 Target time: ${formatTime(targetTime)}`)
    console.log(`🏁 Actual end: ${formatTime(finalTime)}`)
    console.log(`📏 Time difference: ${Math.round(timeDiff / 1000)} seconds ${timeDiff > 0 ? 'late' : 'early'}`)
    console.log(`\n🏁 Adaptive loop mint ended.`)
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n🛑 Received interrupt signal. Stopping loop mint...`)
  process.exit(0)
})

// Run the script
if (require.main === module) {
  loopMint()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export { loopMint }
