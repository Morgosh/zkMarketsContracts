import * as dotenv from "dotenv"

// Initialize environment variables
dotenv.config({ path: ".env" })

// RPC endpoints for different networks (synced with hardhat.config.ts)
export function getRPC(network: string): string {
  const infuraKey = process.env.INFURA_API_KEY
  if (!infuraKey) {
    throw new Error("INFURA_API_KEY not found in .env")
  }
  const alchemyKey = process.env.ALCHEMY_API_KEY
  if (!alchemyKey) {
    throw new Error("ALCHEMY_API_KEY not found in .env")
  }
  
  const rpcMap: Record<string, string> = {
    "zksync-era-testnet": "https://sepolia.era.zksync.dev",
    "zksync-era": "https://mainnet.era.zksync.io",
    "scroll-mainnet": "https://rpc.scroll.io/",
    "sepolia": `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
    "mainnet": `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    "abstract-testnet": "https://api.testnet.abs.xyz",
    "abstract": "https://api.mainnet.abs.xyz/",
    "polygon": `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    "base": `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    "arbitrum": `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    "optimism": `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`,
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