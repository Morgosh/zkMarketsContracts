import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployDiamond } from "./deploy_diamond_functions"
// its initialized in hardhat.config.ts
// initializeDotenv(network, getMainnetOrTestnet(network));

const network: string = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "testnet"

export default async function (_: HardhatRuntimeEnvironment) {
  const marketplaceContract = await deployDiamond({ verify: true, sleepMS: 2000, doLog: true }, { verify: false, sleepMS: 2000, doLog: true })


  // we should have a function to add the marketplace to the database
  // const diamondAddress = (await marketplaceContract.getAddress()).toLowerCase()
  // const AppDataSource = await getDatabaseConnection(network)
  // const newMarketplace = new Marketplace(
  //   {
  //     address: diamondAddress,
  //     lastParsedBlock: 0,
  //     contractName: "DiamondMarketplace",
  //   },
  // )
  // await AppDataSource.getRepository(Marketplace).save(newMarketplace)
}
