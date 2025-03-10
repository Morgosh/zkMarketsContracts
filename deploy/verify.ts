import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract, verifyContract } from "../utils/utils"
import { ethers } from "hardhat"

export default async function (hre: HardhatRuntimeEnvironment) {
  const deployParams = [[
    {
      facetAddress: '0xE9B9a483Fa6179a15032fBE9cF0dBCE60912CCbC',
      action: 0,
      functionSelectors: [ '0x1f931c1c' ]
    },
    {
      facetAddress: '0x09dC6F3f4Ae240a85627E999F094C95D9a64A08D',
      action: 0,
      functionSelectors: [
        '0xcdffacc6',
        '0x52ef6b2c',
        '0xadfca15e',
        '0x7a0ed627',
        '0x01ffc9a7'
      ]
    },
    {
      facetAddress: '0xd1cdb3a670aC7CB2C0B6A25b860E3A615147Bf45',
      action: 0,
      functionSelectors: [ '0x8da5cb5b', '0xf2fde38b' ]
    },
    {
      facetAddress: '0xE66240bf50Af26EC3b455fe1e4D7D6DaF249b84e',
      action: 0,
      functionSelectors: [
        '0x0df26259', '0x6ea8bc10',
        '0xed3471da', '0x24838bb1',
        '0x23a7b42a', '0x418d0cdf',
        '0x12e8e2c3', '0xd13f1b3e',
        '0x6b0e78b2', '0xa96e2423',
        '0xf4f3b200', '0xe086e5ec'
      ]
    },
    {
      facetAddress: '0xdF9Ef9061Fcf2E08d590b6991c5a990BFb68682f',
      action: 0,
      functionSelectors: [
        '0xe6025984', '0x018eeaa5',
        '0x525f1af9', '0x028afabf',
        '0xe2e91595', '0x2952ea96',
        '0xc2fb26a6', '0xed24911d',
        '0x9dd9fb24', '0x288adf7b',
        '0x31cd4199'
      ]
    }
  ],
    {
      owner: '0x981bCF701574E7D084f9d11906dD8f92231A21Dc',
      init: '0xE9B9a483Fa6179a15032fBE9cF0dBCE60912CCbC',
      initCalldata: '0xe1c7392a',
      wethAddress: '0x0000000000000000000000000000000000000000',
      premiumNftAddress: '0x0000000000000000000000000000000000000000',
      platformFee: 0,
      premiumDiscount: 5000
    }
  ]

  const contract = await ethers.getContractFactory("Diamond")

  const contractAddress = "0x7e0fa00d7a02890c66833d4f08f698d15d4ecd01"
  const address = contractAddress
  const constructorArgs = contract.interface.encodeDeploy(deployParams)
  const artifact = await hre.artifacts.readArtifact("Diamond")

  await verifyContract({
    address,
    contract: "contracts/diamond/Diamond.sol:Diamond",
    constructorArguments: constructorArgs,
    bytecode: artifact.bytecode,
  })
  
  // console.log(`yarn hardhat verify --network ${hre.network.name} ${contractAddress} ${deployParams.map(param => `"${param}"`).join(" ")}`)
  console.log(`yarn hardhat verify --network ${hre.network.name} ${contractAddress} ${deployParams.map(param => `"${param}"`).join(" ")}`)
}
