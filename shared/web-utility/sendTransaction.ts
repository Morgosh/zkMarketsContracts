import { Provider, utils } from "zksync-ethers"
import { Contract, ethers } from "ethers"
import ERC20ABI from "../../abis/ERC20Template.abi.json"
import { PaymasterOptions } from "../constants/enums"

export interface TxData {
  to: string
  from?: string
  value?: bigint
  data?: string
}

const defaultGasLimit = 6000000

export async function sendTransaction(
  signer: ethers.Wallet | ethers.JsonRpcSigner,
  method: string,
  txData: TxData,
  paymasterOptions?: PaymasterOptions,
) {
  const provider: Provider = signer.provider as any // zksync-ethers Provider
  let fullTxData: any = txData
  const tx = await signer.sendTransaction(fullTxData)
  return await tx.wait()
}

export async function callContractMethodPolished(
  contract: ethers.Contract, // signer should be passed in
  method: string,
  params: any,
  value: null | bigint,
) {
  const transactionOptions: any = {}
  if (value !== BigInt(0) && value !== null) {
    transactionOptions.value = value
  }
  // in standard contract call we avoid passing value to avoid function ambiguity, for example safetransferfrom has 2 different params functions
  const tx = await contract[method]!(...params, ...(value ? [{ value }] : []))
  const finishedTx = await tx.wait()
  return finishedTx
}
