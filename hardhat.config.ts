import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-ethers"
import "@matterlabs/hardhat-zksync"
import { generatePrivateKeyWithSalt } from "./functions"
import * as dotenv from "dotenv"
import "hardhat-gas-reporter";

// const network: string = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "zksync-era-testnet"
// initializeDotenv(getMainnetOrTestnet(network), null!)
dotenv.config({ path: ".env" })
const deployerKey = process.env.PRIVATE_KEY ?? generatePrivateKeyWithSalt("test")

const config: HardhatUserConfig = {
  defaultNetwork: "zksync-era-testnet",
  networks: {
    "zksync-era-testnet": {
      url: "https://sepolia.era.zksync.dev",
      ethNetwork: "sepolia",
      zksync: true,
      verifyURL: "https://explorer.sepolia.era.zksync.dev/contract_verification",
      accounts: [deployerKey!],
    },
    "zksync-era": {
      url: "https://mainnet.era.zksync.io",
      ethNetwork: "mainnet",
      zksync: true,
      verifyURL: "https://zksync2-mainnet-explorer.zksync.io/contract_verification",
      accounts: [deployerKey!],
      // gasPrice: 33750000
    },
    "scroll-mainnet": {
      chainId: 534352,
      url: "https://rpc.scroll.io/",
      accounts: [deployerKey!],
    },
    "zkHardhat": {
      url: "http://localhost:3050",
      ethNetwork: "http://localhost:8545",
      zksync: true,
      accounts: [],
    },
    "hardhat": {
      // zksync: true,
    },
    "abstract-testnet": {
      url: "https://api.testnet.abs.xyz",
      ethNetwork: "sepolia",
      // etherscan aka https://api-sepolia.abscan.org/api doesn't seem to work, but blockscout does
      verifyURL: "https://api-explorer-verify.testnet.abs.xyz/contract_verification",
      zksync: true,
      chainId: 11124,
      accounts: [deployerKey!],
    },
    "abstract": {
      url: "https://abstract-mainnet.blastapi.io/aabef526-e6c5-405f-8bcd-d470a2058702/",
      ethNetwork: "mainnet",
      // etherscan aka https://api-sepolia.abscan.org/api doesn't seem to work, but blockscout does
      verifyURL: "https://api-explorer-verify.abs.xyz/contract_verification",
      zksync: true,
      chainId: 2741,
      accounts: [deployerKey!],
    },
  },
  zksolc: {
    version: "latest",
    settings: {
      // find all available options in the official documentation
      // https://era.zksync.io/docs/tools/hardhat/hardhat-zksync-solc.html#configuration
      // libraries: {
      //       "contracts/diamond/libraries/SharedStorage.sol": {
      //         "SharedStorage": "0x8803DC20b68f58cF20447F16383F73125eE4E352"
      //       }
      //     }
    },
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  gasReporter: {
    currency: 'USD',
    L1: "ethereum",
    enabled: (process.env.REPORT_GAS) ? true : false
  }
}

export default config
