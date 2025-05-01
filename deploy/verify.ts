import { HardhatRuntimeEnvironment } from "hardhat/types"
import { deployContract, verifyContract } from "../utils/utils"
import { ethers } from "hardhat"

export default async function (hre: HardhatRuntimeEnvironment) {
  const nootAddress = "0x3d8b869eB751B63b7077A0A93D6b87a54e6C8f56"
  const trustedSigner = "0x9a1E4E03fb299F223b37c67691de9461257848b4"
  const minWager = ethers.parseEther("100").toString()
  const maxWager = ethers.parseEther("10000").toString()
  const deployParams = [
    nootAddress,    // NOOT token address
    trustedSigner,  // Trusted signer address
    minWager,       // Minimum wager as string
    maxWager        // Maximum wager as string
  ];

  const contract = await ethers.getContractFactory("NootLadder")

  const contractAddress = "0xe3c2d2181bc88a4cab3cf6fc30b58cc436b4e6e0"
  const constructorArgs = contract.interface.encodeDeploy(deployParams)
  const artifact = await hre.artifacts.readArtifact("NootLadder")

  await verifyContract({
    address: contractAddress,
    contract: "contracts/nootLadder.sol:NootLadder",
    constructorArguments: constructorArgs,
    bytecode: artifact.bytecode,
  })
  
  // console.log(`yarn hardhat verify --network ${hre.network.name} ${contractAddress} ${deployParams.map(param => `"${param}"`).join(" ")}`)
  console.log(`yarn hardhat verify --network ${hre.network.name} ${contractAddress} ${deployParams.map(param => `"${param}"`).join(" ")}`)
}
