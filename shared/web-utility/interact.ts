// This file is used to interact with zkMarkets marketplace contract
// which can be used by any dapp, console or web
// while avoiding web specific code

import { ethers } from "ethers"
import diamondAAMarketplaceABI from "../../abis/Diamond.abi.json"
import ERC721MerkleABI from "../../abis/ERC721Merkle.abi.json"
import ERC20ABI from "../../abis/ERC20Template.abi.json"
import WETHABI from "../../abis/WETH.abi.json"
import { getOrderEIP712Data } from "./interactGetters"
import { BasicOrderType, OrderParameters, PaymasterOptions } from "../constants/enums"
import { maxBigInt, minBigInt } from "./utility"
import { sendTransaction } from "./sendTransaction"

export async function acceptOrder(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  signature: string,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )

  // we made this function for BasicOrderType.ERC721_FOR_ETH and BasicOrderType.ERC20_FOR_ERC721
  if (![BasicOrderType.ERC721_FOR_ETH, BasicOrderType.ERC20_FOR_ERC721].includes(orderParameters.orderType)) throw new Error("Order type not supported")
  if (orderParameters.orderType == BasicOrderType.ERC721_FOR_ETH) {
    // console.log("1")
  }
  else if (orderParameters.orderType == BasicOrderType.ERC20_FOR_ERC721) {
    // we have to check that user gave nft approval
    await ifNotApprovedApproveForAll(signer, orderParameters.consideration.tokenAddress!, marketplaceContractAddress, smartAccountAddress, paymasterOptions)
    // console.log("2")
  }

  return await callContractMethod(
    marketplaceContract,
    "acceptOrder",
    [
      {
        parameters: orderParameters,
        signature,
      },
      orderParameters.royaltyPercentageIn10000,
    ],
    orderParameters.orderType == BasicOrderType.ERC721_FOR_ETH ? orderParameters.consideration.amount : null,
    smartAccountAddress,
    paymasterOptions,
  )
}

export async function acceptCollectionOfferOrder(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  signature: string,
  nftTokenId: string,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )
  if (orderParameters.orderType != BasicOrderType.ERC20_FOR_ERC721_ANY) throw new Error("Order type not supported")
  await ifNotApprovedApproveForAll(signer, orderParameters.consideration.tokenAddress!, marketplaceContractAddress, smartAccountAddress, paymasterOptions)

  return await callContractMethod(
    marketplaceContract,
    "acceptCollectionOffer",
    [
      {
        parameters: orderParameters,
        signature,
      },
      orderParameters.royaltyPercentageIn10000,
      nftTokenId,
    ],
    null,
    smartAccountAddress,
    paymasterOptions,
  )
}

export async function batchAcceptOrder(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orders: OrderParameters[],
  signatures: string[],
  royaltyPercentagesIn10000: number[],
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )

  const ordersWithSignatures = orders.map((order, index) => {
    return {
      parameters: order,
      signature: signatures[index],
    }
  })
  const totalAmount = orders.reduce((acc, order) => {
    return acc + BigInt(order.consideration.amount)
  }, BigInt(0))
  return await callContractMethod(
    marketplaceContract,
    "batchAcceptOrder",
    [
      ordersWithSignatures,
      royaltyPercentagesIn10000,
    ],
    totalAmount,
    smartAccountAddress,
    paymasterOptions,
  )
}

export async function cancelOrder(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  signature: string,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  // we need to pass all the data to the contract to verify the signature, not just the hash
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )

  return await callContractMethod(
    marketplaceContract,
    "cancelOrder",
    [
      {
        parameters: orderParameters,
        signature,
      },
    ],
    null,
    smartAccountAddress,
    paymasterOptions,
  )
}

export async function cancelAllOrders(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )

  return await callContractMethod(
    marketplaceContract,
    "cancelAllOrders",
    [],
    null,
    smartAccountAddress,
    paymasterOptions,
  )
}

export async function ifNotApprovedApproveForAll(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  nftAddress: string,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const nftContract = new ethers.Contract(nftAddress, ERC721MerkleABI, signer)

  const isApproved = await nftContract.isApprovedForAll(
    smartAccountAddress || signer.address,
    marketplaceContractAddress,
  )
  if (!isApproved) {
    return await callContractMethod(
      nftContract,
      "setApprovalForAll",
      [marketplaceContractAddress, true],
      null,
      smartAccountAddress,
      paymasterOptions,
    )
  }
}

export async function createOffchainListingOrderWithApproval(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )

  await ifNotApprovedApproveForAll(signer, orderParameters.offer.tokenAddress!, marketplaceContractAddress, smartAccountAddress, paymasterOptions)
  const { hash, domain, types, message } = await getOrderEIP712Data(
    signer.provider!,
    orderParameters,
    marketplaceContractAddress,
  )
  const signature = await signer.signTypedData(domain, types, message)
  const signatureVerified = await marketplaceContract.verifySignature(
    hash,
    signature,
    signer.address,
  )

  if (!signatureVerified)
    throw new Error(
      "Listing Signature cannot be verified, please check the network or try switching price",
    )
  return { hash, signature }
}

export async function createOffchainOfferOrderWithApproval(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  marketplaceContractAddress: string,
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  // Offerer must be the signer
  if (orderParameters.offerer.toLowerCase() !== signer.address.toLowerCase()) throw new Error("Offerer must be the signer")
  // console.log("orderParameters", orderParameters, signer.address)
  await setERC20AllowanceForOffer(signer, orderParameters, marketplaceContractAddress, smartAccountAddress, paymasterOptions)
  return await createOffchainOfferOrder(signer, orderParameters, marketplaceContractAddress)
}

export async function setERC20AllowanceForOffer(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  marketplaceContractAddress = "",
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  // check allowance, for now we could just add allowance to existing allowance
  const minAllowance = ethers.parseEther("1")
  const tokenContract = new ethers.Contract(orderParameters.offer.tokenAddress!, ERC20ABI, signer)
  const allowance = await tokenContract.allowance(signer.address, marketplaceContractAddress)
  // lets fetch user balance aswell
  const balance = await tokenContract.balanceOf(signer.address)
  // max allowance is max(5,currentBalance), unless offer offer amount is higher
  const maxAllowance = minBigInt(maxBigInt(ethers.parseEther("5"), orderParameters.offer.amount), balance)

  // set new allowance, if more can be set
  // if he doens't have balance we need to return error
  if (balance < orderParameters.offer.amount) throw new Error("Insufficient balance 1")

  // only add allowance if it's less than 1 eth or less what's being offered
  if ((allowance < maxAllowance) && (allowance < minAllowance || allowance < orderParameters.offer.amount)) {
    // add to allowance
    const newAllowance = maxAllowance
    await callContractMethod(
      tokenContract,
      "approve",
      [marketplaceContractAddress, newAllowance],
      null,
      smartAccountAddress,
      paymasterOptions,
    )
  }
}

export async function createOffchainOfferOrder(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  orderParameters: OrderParameters,
  marketplaceContractAddress = "",
) {
  const marketplaceContract = new ethers.Contract(
    marketplaceContractAddress,
    diamondAAMarketplaceABI,
    signer,
  )
  const { hash, domain, types, message } = await getOrderEIP712Data(
    signer.provider!,
    orderParameters,
    marketplaceContractAddress,
  )
  const signature = await signer.signTypedData(domain, types, message)
  const signatureVerified = await marketplaceContract.verifySignature(
    hash,
    signature,
    signer.address,
  )

  if (!signatureVerified)
    throw new Error(
      "Listing Signature cannot be verified, please check the network or try switching price",
    )
  return { hash, signature }
}

// erc721 functions
// erc721 functions
// erc721 functions

export async function transferItem(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  nftAddress: string,
  tokenId: string,
  toAddress: string,
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const nftContract = new ethers.Contract(nftAddress, ERC721MerkleABI, signer)
  // const tx = await nftContract.safeTransferFrom(signer.address, toAddress, tokenId)

  // return await nftContract.safeTransferFrom(smartAccountAddress || signer.address, toAddress, tokenId)
  return await callContractMethod(
    nftContract,
    "safeTransferFrom(address,address,uint256)",
    [smartAccountAddress || signer.address, toAddress, tokenId],
    BigInt(0),
    smartAccountAddress,
    paymasterOptions,
  )
}

export async function mint(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  nftAddress: string,
  amount: number,
  priceWei: bigint,
  smartAccountAddress = "",
  paymasterOptions?: PaymasterOptions,
) {
  const nftContract = new ethers.Contract(nftAddress, ERC721MerkleABI, signer)
  return await callContractMethod(
    nftContract,
    "mint",
    [amount],
    BigInt(priceWei),
    smartAccountAddress,
    paymasterOptions,
  )
}

// ETH functions
// ETH functions
// ETH functions

export async function sendEth(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  toAddress: string,
  amountWei: bigint,
  smartAccountAddress = "",
) {
  if (!smartAccountAddress) {
    const tx = await signer.sendTransaction({
      to: toAddress,
      value: amountWei,
    })
    return await tx.wait()
  }
  else {
    // let saTx: ethers.TransactionRequest = {
    //   to: toAddress,
    //   value: BigInt(amountWei),
    //   data: "0x",
    // }
    // const chainId = (await signer.provider!.getNetwork()).chainId
    // saTx = await populateZkSyncSATransaction(
    //   saTx,
    //   signer.provider as any,
    //   chainId,
    //   BigInt(1000000),
    //   smartAccountAddress,
    // )
    // const EIP712Signer1 = new EIP712Signer(signer, Number(chainId))
    // const txSignature = await EIP712Signer1.sign(saTx)
    // saTx.customData.customSignature = txSignature
    // const tx = await signer.provider!.broadcastTransaction(utils.serializeEip712(saTx as any))
    // return await tx.wait()
  }
}

export async function wrapETH(signer: ethers.Wallet | ethers.JsonRpcSigner, amountWei: bigint, wrapperAddress: string, paymasterOptions?: PaymasterOptions) {
  const wethContract = new ethers.Contract(wrapperAddress, WETHABI, signer)
  return await callContractMethod(wethContract, "deposit", [], amountWei, "", paymasterOptions)
}

export async function unwrapETH(signer: ethers.Wallet | ethers.JsonRpcSigner, amountWei: bigint, wrapperAddress: string, paymasterOptions?: PaymasterOptions) {
  const wethContract = new ethers.Contract(wrapperAddress, WETHABI, signer)
  return await callContractMethod(wethContract, "withdraw", [amountWei], BigInt(0), "", paymasterOptions)
}

// to combine standard transactions with smart account transactions
export async function callContractMethod(
  contract: ethers.Contract, // signer should be passed in
  method: string,
  params: any,
  value: null | bigint,
  SAAddress?: string, // determines if it's SA or not
  paymasterOptions?: PaymasterOptions,
) {
  // lets make sure contract has valid address
  if (!ethers.isAddress(await contract.getAddress())) throw new Error("Contract address is not valid")
  if (!SAAddress) {
    const signer = contract.runner as any
    const txData: any = {
      from: await signer.getAddress(),
      to: await contract.getAddress(),
      data: contract.interface.encodeFunctionData(method, params),
    }
    if (value !== BigInt(0) && value !== null) {
      txData.value = value // use string instead of bigint
    }
    return await sendTransaction(signer, method, txData, paymasterOptions)
  }
  else {
    throw new Error("Smart Account transactions not supported")
  }
}
