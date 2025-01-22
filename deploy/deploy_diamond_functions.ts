/* global */
/* eslint prefer-const: "off" */

// const { ethers } = require('hardhat')
// import { ethers } from 'hardhat'
// import { ethers } from 'hardhat';

import { ethers } from "hardhat"

// const erc721Contract = await deployContract("ERC721Template", deployParams)

// const { getSelectors, FacetCutAction } = require('./libraries/diamond.ts')
import { getSelectors, FacetCutAction } from "./libraries/diamond"
import { deployContract, getDefaultWallet } from "../utils/utils"

async function deployDiamond(options: any = {}, transactFacetOptions: any = null) {
  const contractOwner = await getDefaultWallet()

  // Deploy DiamondInit
  // DiamondInit provides a function that is called when the diamond is upgraded or deployed to initialize state variables
  // Read about how the diamondCut function works in the EIP2535 Diamonds standard
  const diamondInitContract = await deployContract("DiamondInit", [], options)
  console.log("DiamondInit deployed:", await diamondInitContract.getAddress())

  // deployed Libs
  const sharedStorageContract = await deployContract("SharedStorage", [], options)
  console.log(`SharedStorage deployed to: ${await sharedStorageContract.getAddress()}`)

  // Deploy facets and set the `facetCuts` variable
  console.log("")
  console.log("Deploying facets")
  // const FacetNames = [
  //   'DiamondCutFacet',
  //   'DiamondLoupeFacet',
  //   'OwnershipFacet',
  //   'ManagementFacet',
  //   'TransactFacet',
  // ]

  const facets: { name: string, libraries?: any }[] = [
    {
      name: "DiamondCutFacet",
    },
    {
      name: "DiamondLoupeFacet",
    },
    {
      name: "OwnershipFacet",
    },
    {
      name: "ManagementFacet",
      // libraries: {
      //   SharedStorage: await sharedStorage.getAddress(),
      // },
    },
    {
      name: "TransactFacet",
      // libraries: {
      //   SharedStorage: await sharedStorageContract.getAddress(),
      // },
    },
  ]

  // The `facetCuts` variable is the FacetCut[] that contains the functions to add during diamond deployment
  const facetCuts: any = []
  for (const facetObj of facets) {
    // const Facet = await ethers.getContractFactory(facetObj.name, {
    //   libraries: facetObj.libraries,
    // })
    // const facet = await Facet.deploy()
    // await facet.waitForDeployment()
    // const options: any = facetObj.libraries ? { libraries: facetObj.libraries } : {}
    let chosenOptions = options
    if (facetObj.name === "TransactFacet" && transactFacetOptions) {
      chosenOptions = transactFacetOptions
    }
    const facetContract = await deployContract(facetObj.name, [], chosenOptions)
    console.log(`${facetObj.name} deployed: ${await facetContract.getAddress()}`)
    facetCuts.push({
      facetAddress: await facetContract.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(facetContract),
    })
  }

  // Creating a function call
  // This call gets executed during deployment and can also be executed in upgrades
  // It is executed with delegatecall on the DiamondInit address.
  let functionCall = diamondInitContract.interface.encodeFunctionData("init")

  // Setting arguments that will be used in the diamond constructor
  const diamondArgs = {
    owner: contractOwner.address,
    init: await diamondInitContract.getAddress(),
    initCalldata: functionCall,
    // add any other custom arguments here
    wethAddress: ethers.ZeroAddress,
    premiumNftAddress: ethers.ZeroAddress,
    platformFee: 200, // 2%
    premiumDiscount: 5000, // 50%
  }

  // deploy Diamond
  // const Diamond = await ethers.getContractFactory('Diamond')
  // const diamond = await Diamond.deploy(facetCuts, diamondArgs)
  // await diamond.waitForDeployment()
  const diamondContract = await deployContract("Diamond", [facetCuts, diamondArgs], options)
  console.log()
  console.log("Diamond deployed:", (await diamondContract.getAddress()).toLowerCase())

  // returning the address of the diamond
  return await diamondContract
}

// Example function to update a single facet
async function updateFacet(diamondAddress: string, newFacetContractName: string, chosenOptions: any = {}) {
  const wallet = await getDefaultWallet()
  // lets fetch ownerOf the diamond
  // const diamond = await ethers.getContractAt('Diamond', diamondAddress, contractOwner)
  const diamondContract = new ethers.Contract(diamondAddress, ["function owner() view returns (address)"], wallet)
  const owner = await diamondContract.owner()
  console.log("Owner of diamond:", owner)
  // owners must be the same
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw Error(`Wallet address ${wallet.address} is not the owner of diamond ${diamondAddress}`)
  }

  // Deploy the updated facet
  const facetContract = await deployContract(newFacetContractName, [], chosenOptions)
  console.log(`${newFacetContractName} deployed: ${await facetContract.getAddress()}`)

  // Prepare the cut instruction for replacing the facet
  const cut = [{
    facetAddress: await facetContract.getAddress(),
    action: FacetCutAction.Replace,
    functionSelectors: getSelectors(facetContract),
  }]

  // Execute the diamond cut
  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress, wallet) // Assuming `diamond.address` is available

  let functionCall = "0x" // Indicates no function call is necessary
  const tx = await diamondCut.diamondCut(cut, ethers.ZeroAddress, functionCall) // Use AddressZero if no init function
  console.log("Diamond cut tx: ", tx.hash)
  const receipt = await tx.wait()

  if (!receipt.status) {
    throw Error(`Facet update failed: ${tx.hash}`)
  }
  console.log("Facet updated successfully")
}

// Example function to update a facet, if the selectors change 
async function updateFacetFully(diamondAddress: string, facetContractName: string, oldFacetABI: any, chosenOptions: any = {}) {
  const wallet = await getDefaultWallet()
  // lets fetch ownerOf the diamond
  // const diamond = await ethers.getContractAt('Diamond', diamondAddress, contractOwner)
  const diamondContract = new ethers.Contract(diamondAddress, ["function owner() view returns (address)"], wallet)
  const owner = await diamondContract.owner()
  console.log("Owner of diamond:", owner)
  // owners must be the same
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw Error(`Wallet address ${wallet.address} is not the owner of diamond ${diamondAddress}`)
  }

  // lets initialize old facet, we can probably use a dummy address
  const oldFacet = new ethers.Contract(ethers.ZeroAddress, oldFacetABI, wallet)
  // Deploy the updated facet
  const facetContract = await deployContract(facetContractName, [], chosenOptions)
  console.log(`${facetContractName} deployed: ${await facetContract.getAddress()}`)

  // Prepare the cut instruction for replacing the facet
  const cut = [
    {
      facetAddress: ethers.ZeroAddress,
      action: FacetCutAction.Remove,
      functionSelectors: getSelectors(oldFacet),
    },
    {
      facetAddress: await facetContract.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(facetContract),
    },
  ]

  // Execute the diamond cut
  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress, wallet) // Assuming `diamond.address` is available

  let functionCall = "0x" // Indicates no function call is necessary
  const tx = await diamondCut.diamondCut(cut, ethers.ZeroAddress, functionCall) // Use AddressZero if no init function
  console.log("Diamond cut tx: ", tx.hash)
  const receipt = await tx.wait()

  if (!receipt.status) {
    throw Error(`Facet update failed: ${tx.hash}`)
  }
  console.log("Facet updated successfully")
}

export { deployDiamond, updateFacet, updateFacetFully }
