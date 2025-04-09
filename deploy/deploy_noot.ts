import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function (hre: HardhatRuntimeEnvironment) {

  const options = {
    verify: true,
    doLog: true,
  }

  const deployParams: any = ["Noot", "NOOT"]

  const nootContract = await deployContract("Noot", deployParams, options)
}
