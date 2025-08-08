// import { HardhatUserConfig } from "hardhat/config"
// import "@nomicfoundation/hardhat-ethers"
// import { generatePrivateKeyWithSalt } from "./functions"
// import * as dotenv from "dotenv"
// import "hardhat-gas-reporter";
// import 'solidity-coverage';


// // const network: string = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "zksync-era-testnet"
// // initializeDotenv(getMainnetOrTestnet(network), null!)
// dotenv.config({ path: ".env" })
// const deployerKey = process.env.PRIVATE_KEY ?? generatePrivateKeyWithSalt("test")

// const config: HardhatUserConfig = {
//   networks: {
//     "sepolia": {
//       chainId: 11155111,
//       url: "https://eth-sepolia.g.alchemy.com/public",
//       accounts: [deployerKey!],
//     },
//     "mainnet": {
//       chainId: 1,
//       url: "https://rpc.ankr.com/eth",
//       accounts: [deployerKey!],
//     },
//     "hardhat": {
//       // zksync: true,
//     },
//   },
//   etherscan: {
//     apiKey: process.env.ETHERSCAN_API_KEY, // use the corresponding key depending on the network
//   },
//   solidity: {
//     version: "0.8.24",
//     settings: {
//       optimizer: {
//         enabled: true,
//         runs: 200,
//       },
//       viaIR: true,
//     },
//   },
//   gasReporter: {
//     currency: 'USD',
//     L1: "ethereum",
//     enabled: (process.env.REPORT_GAS) ? true : false
//   }
// }

// export default config
