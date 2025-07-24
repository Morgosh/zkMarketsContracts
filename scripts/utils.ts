import * as dotenv from "dotenv"

// Initialize environment variables
dotenv.config({ path: ".env" })

// RPC endpoints for different networks (standalone for scripts)
export function getRPC(network: string): string {
  const rpcMap: Record<string, string> = {
    "zksync-era-testnet": "https://sepolia.era.zksync.dev",
    "zksync-era": "https://mainnet.era.zksync.io",
    "scroll-mainnet": "https://rpc.scroll.io/",
    "sepolia": `https://eth-sepolia.g.alchemy.com/public`,
    "mainnet": `https://rpc.ankr.com/eth`,
    "abstract-testnet": "https://api.testnet.abs.xyz",
    "abstract": "https://api.mainnet.abs.xyz/",
  }
  
  if (!rpcMap[network]) {
    throw new Error(`Unsupported network: ${network}`)
  }
  
  return rpcMap[network]
}

// Get network from command line args or default
export function getNetwork(): string {
  return process.argv.includes("--network") 
    ? process.argv[process.argv.indexOf("--network") + 1] 
    : "zksync-era-testnet"
} 