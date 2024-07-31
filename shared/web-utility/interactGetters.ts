// in this file I want to put all the functions that interact with the blockchain
// which can be used by any dapp, console or web
// while avoiding web specific code

import { TypedDataDomain, TypedDataEncoder, ethers } from "ethers"
import marketplaceABI from "../../abis/Diamond.abi.json"
import ERC721ABI from "../../abis/ERC721Template.abi.json"
import { Contract } from "zksync-ethers"
import { OrderParameters } from "../constants/enums"

export async function getOnchainDomain(
  provider: ethers.Provider,
  marketplaceContractAddress: string,
) {
  const marketplaceContract = new Contract(marketplaceContractAddress, marketplaceABI, provider)
  try {
    const onchainDomain = await marketplaceContract.domain()
    const domain: TypedDataDomain = {
      name: onchainDomain[0],
      version: onchainDomain[1],
      chainId: onchainDomain[2],
      verifyingContract: onchainDomain[3],
    }
    return domain
  }
  catch (error) {
    console.error("failedToFetchOnchainDomain")
    return {
      name: "zkMarkets",
      version: "1",
      chainId: 1,
      verifyingContract: marketplaceContractAddress,
    }
  }
}

export async function getOrderEIP712Data(
  provider: ethers.Provider,
  orderParameters: OrderParameters,
  marketplaceContractAddress = "",
) {
  const domain = await getOnchainDomain(provider, marketplaceContractAddress)
  const types = {
    // Custom types used in your message
    OrderParameters: [ // This would be the actionType in your previous function setup
      { name: "offerer", type: "address" },
      { name: "orderType", type: "uint8" },
      { name: "offer", type: "Item" },
      { name: "consideration", type: "Item" },
      { name: "royaltyReceiver", type: "address" },
      { name: "royaltyPercentageIn10000", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "createdTime", type: "uint256" },
    ],
    Item: [
      { name: "itemType", type: "uint8" },
      { name: "tokenAddress", type: "address" },
      { name: "identifier", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
  }
  const message = {
    offerer: orderParameters.offerer,
    orderType: orderParameters.orderType,
    offer: {
      itemType: orderParameters.offer.itemType,
      tokenAddress: orderParameters.offer.tokenAddress,
      identifier: orderParameters.offer.identifier,
      amount: orderParameters.offer.amount,
    },
    consideration: {
      itemType: orderParameters.consideration.itemType,
      tokenAddress: orderParameters.consideration.tokenAddress,
      identifier: orderParameters.consideration.identifier,
      amount: orderParameters.consideration.amount,
    },
    royaltyReceiver: orderParameters.royaltyReceiver,
    royaltyPercentageIn10000: orderParameters.royaltyPercentageIn10000,
    startTime: orderParameters.startTime,
    endTime: orderParameters.endTime,
    createdTime: orderParameters.createdTime,
  }

  // lets make sure all types are define and no are undefined
  Object.entries(message).forEach(([key, value]) => {
    if (value === undefined) {
      throw new Error("undefined key: " + key)
    }
  })
  const hash = TypedDataEncoder.hash(domain, types, message)
  return { hash, domain, types, message }
}