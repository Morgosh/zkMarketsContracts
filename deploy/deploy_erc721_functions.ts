import { DeployContractOptions, deployContract } from "../utils/utils"
import MerkleTree from "merkletreejs"
import keccak256 from "keccak256"
import { getLeafNodes, getRootHash, uploadMerkleProofs } from "../merkle/merkleFunctions"
import { ethers } from "hardhat"
import { Contract } from "ethers"

export interface CollectionData {
  publicMintStartTime?: number
  publicMaxMintAmount?: number
}

export interface Tier {
  addresses: string[]
  priceWei: ReturnType<typeof ethers.parseEther>
  tier: number
  maxMint: number
  startTime: number
}

export async function deployERC721(
  contractName: string,
  deployParams: any[],
  options: DeployContractOptions,
  collectionData: CollectionData,
) {
  console.log(`Running deploy script for the ${contractName} contract with params`, deployParams)

  const contract = await deployContract(contractName, deployParams, options)

  if (collectionData.publicMintStartTime) {
    await contract.setPublicSaleStartTime(collectionData.publicMintStartTime)
  }
  if (collectionData.publicMaxMintAmount) {
    await contract.setPublicMaxMintAmount(collectionData.publicMaxMintAmount)
  }

  const contractAddress = (await contract.getAddress()).toLowerCase()
  return contractAddress
}

export async function deployTiers(tiers: Tier[], contract: Contract, appDataSource: any) {
  for (const tierData of tiers) {
    const merkleTree = new MerkleTree(getLeafNodes(tierData.addresses), keccak256, { sortPairs: true })
    const tx = await contract.setTier(tierData.tier, tierData.tier, getRootHash(merkleTree), tierData.priceWei, tierData.maxMint, tierData.startTime)
    await tx.wait()
    await uploadMerkleProofs(appDataSource, await contract.getAddress(), tierData.tier, merkleTree, tierData.addresses)
  }
}

export function filterAddresses(addresses: string[]) {
  const filter1 = addresses.filter(address => ethers.isAddress(address)).map(address => address.toLowerCase())
  // remove duplicates
  const filter2: string[] = []
  filter1.forEach((address) => {
    if (!filter2.includes(address)) {
      filter2.push(address)
    }
  })
  return filter2
}
