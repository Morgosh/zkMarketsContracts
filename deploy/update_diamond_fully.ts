import { HardhatRuntimeEnvironment } from "hardhat/types"
import { updateFacetFully } from "./deploy_diamond_functions"

import oldTransactFacet from "../abis/old/TransactFacet.abi.json"
import oldManagementFacet from "../abis/old/ManagementFacet.abi.json"
const updateFacetName = "TransactFacet"

const address = process.env.MARKETPLACE_ADDRESS

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!address) {
    console.log("Please provide a marketplace address using the --address flag")
    return
  }
  console.log("Marketplace address: ", address)
  await updateFacetFully(address, "TransactFacet", oldTransactFacet, { verify: false, sleepMS: 2000, doLog: true })
  await updateFacetFully(address, "ManagementFacet", oldManagementFacet, { verify: false, sleepMS: 2000, doLog: true })
}
