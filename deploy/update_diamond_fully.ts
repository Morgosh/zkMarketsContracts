import { HardhatRuntimeEnvironment } from "hardhat/types"
import { updateFacetFully } from "./deploy_diamond_functions"

import oldABI from "../abis/TransactFacetOld.abi.json"
const updateFacetName = "TransactFacet"
const address: string = process.argv.includes("--address") ? process.argv[process.argv.indexOf("--address") + 1] : ""

// note that we probably don't need to specify the old address
const oldAddress = "0xcC11D9b4Cc7A606f64A6B862d920312798bcd2ef"

export default async function (hre: HardhatRuntimeEnvironment) {
  if (!address) {
    console.log("Please provide a marketplace address using the --address flag")
    return
  }
  console.log("Marketplace address: ", address)
  await updateFacetFully(address, updateFacetName, oldAddress, oldABI,
    { verify: false, sleepMS: 2000, doLog: true })
}
