import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

export default async function (hre: HardhatRuntimeEnvironment) {

  const options = {
    verify: true,
    doLog: true,
  }

  const deployParams: any = ["Wrapped ETH", "WETH"]

  const adminContract = await deployContract("ERC20Template", deployParams, options)
}
