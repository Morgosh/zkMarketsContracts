import { HardhatRuntimeEnvironment } from "hardhat/types"
import { updateFacet } from "./deploy_diamond_functions"
const address: string = process.argv.includes("--address") ? process.argv[process.argv.indexOf("--address") + 1] : ""

const updateFacetName = "TransactFacet"
export default async function (hre: HardhatRuntimeEnvironment) {
  if (!address) {
    console.log("Please provide a marketplace address using the --address flag")
    return
  }
  console.log("Marketplace address: ", address)
  await updateFacet(address, updateFacetName, { verify: false, sleepMS: 2000, doLog: true })
}
