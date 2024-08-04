import { HardhatRuntimeEnvironment } from "hardhat/types"
import { updateFacet } from "./deploy_diamond_functions"

const address = process.env.MARKETPLACE_ADDRESS

const updateFacetName = "TransactFacet"
export default async function (hre: HardhatRuntimeEnvironment) {
  if (!address) {
    console.log("Please provide a marketplace address")
    return
  }
  console.log("Marketplace address: ", address)
  await updateFacet(address, updateFacetName, { verify: false, sleepMS: 2000, doLog: true })
}
