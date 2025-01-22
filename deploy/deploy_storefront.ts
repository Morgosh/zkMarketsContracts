import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract } from "../utils/utils"

const deployParams: any = ["zkMarkets storefront", "STORE", 0, "ipfs://QmQ6eDgNhyzPsxwMbqLzUNgLTioYWEwoj5qQUSBpUXCmnn"]
export default async function (hre: HardhatRuntimeEnvironment) {

  const options = {
    verify: true,
    doLog: true,
  }

  const adminContract = await deployContract("Storefront", deployParams, options)
}
