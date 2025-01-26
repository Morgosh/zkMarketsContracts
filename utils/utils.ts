import { ethers } from "ethers"
import "@matterlabs/hardhat-zksync-node/dist/type-extensions"
import "@matterlabs/hardhat-zksync-verify/dist/src/type-extensions"
import "@nomicfoundation/hardhat-ethers"

import hre, { ethers as hardhatEthers } from "hardhat"
import { Deployer } from "@matterlabs/hardhat-zksync"

import { Provider, Wallet } from "zksync-ethers"

export interface DeployContractOptions {
  // If true, the deployment process will not print any logs
  doLog?: boolean
  // sleep before deployment
  sleepMS?: number
  // If true, the contract will not be verified on Block Explorer
  verify?: boolean
  // If specified, the contract will be deployed using this wallet
  wallet?: Wallet | any // hardhatEthers.Signer
  // If specified, the contract will be deployed with the specified libraries
  libraries?: any
}

export const isZkSyncNetwork = () => {
  try {
    // make sure its not undefined
    if (hre.network.config.zksync) {
      return true
    }
  }
  catch (error) {
    return false
  }
  return false
}

export const deployContractZkSync = async (contractArtifactName: string, constructorArguments?: any[], options?: DeployContractOptions) => {
  const log = (message: string) => {
    if (options?.doLog) console.log(message)
  }
  const walletZkSync = !options?.wallet ? await getDefaultWallet() : options.wallet
  const deployer = new Deployer(hre, walletZkSync as Wallet)

  const artifact = await deployer.loadArtifact(contractArtifactName).catch((error) => {
    if (error?.message?.includes(`Artifact for contract "${contractArtifactName}" not found.`)) {
      console.error(error.message)
      throw "⛔️ Please make sure you have compiled your contracts or specified the correct contract name!"
    }
    else {
      throw error
    }
  })

  // Estimate contract deployment fee
  const deploymentFee = await deployer.estimateDeployFee(artifact, constructorArguments || [])
  log(`Estimated deployment cost: ${ethers.formatEther(deploymentFee)} ETH`)

  // Check if the wallet has enough balance
  // await verifyEnoughBalance(wallet, deploymentFee);

  if (options?.sleepMS) {
    log(`Sleeping for ${options.sleepMS} MS...`)
    await new Promise(r => setTimeout(r, options.sleepMS!))
  }

  // Deploy the contract to zkSync
  const contract = await deployer.deploy(artifact, constructorArguments)
  const address = await contract.getAddress()
  const constructorArgs = contract.interface.encodeDeploy(constructorArguments)
  const fullContractSource = `${artifact.sourceName}:${artifact.contractName}`

  // Display contract deployment info
  log(`\n"${artifact.contractName}" was successfully deployed:`)
  console.log(`Deployed ${contractArtifactName} address: ${address.toLowerCase()}`)
  log(` - Contract source: ${fullContractSource}`)
  log(` - Encoded constructor arguments: ${constructorArgs}\n`)

  // @ts-expect-error verifyURL does not exist
  if (options?.verify && hre.network.config && hre.network.config.verifyURL) {
    log("Requesting contract verification...")
    await verifyContract({
      address,
      contract: fullContractSource,
      constructorArguments: constructorArgs,
      bytecode: artifact.bytecode,
    })
  }

  return contract
}

/**
 * @param {string} data.contract The contract's path and name. E.g., "contracts/Greeter.sol:Greeter"
 */
export const verifyContract = async (data: {
  address: string
  contract: string
  constructorArguments: string
  bytecode: string
}) => {
  const verificationRequestId: number = await hre.run("verify:verify", {
    ...data,
    noCompile: true,
  })
  return verificationRequestId
}

export const deployContract = async (contractArtifactName: string, constructorArguments: any[] = [], options?: DeployContractOptions) => {
  if (options?.doLog) console.log(`\nStarting deployment process of "${contractArtifactName}"... on ${hre.network.name} network`)
  if (isZkSyncNetwork()) {
    return deployContractZkSync(contractArtifactName, constructorArguments, options)
  }
  else {
    let factory
    if (options?.libraries) {
      factory = await hre.ethers.getContractFactory(contractArtifactName, {
        libraries: options.libraries,
      })
    }
    else {
      factory = await hre.ethers.getContractFactory(contractArtifactName)
    }

    if (options?.sleepMS) {
      console.log(`Sleeping for ${options.sleepMS} MS...`)
      await new Promise(r => setTimeout(r, options.sleepMS!))
    }
    const contract = await factory.deploy(...constructorArguments)
    await contract.waitForDeployment()
    return contract
  }
}

export async function getDefaultWallet() {
  const signers = await hardhatEthers.getSigners()
  if (isZkSyncNetwork()) {
    // now if signers[0] matches process.env.PRIVATE_KEY then we return that, otherwise we return the first rich wallet
    if (process.env.PRIVATE_KEY) {
      const privateKey = process.env.PRIVATE_KEY
      const wallet = new Wallet(privateKey, getzkProvider())
      if (signers && signers.length > 0 && signers[0].address === wallet.address) {
        return wallet
      } else {
        console.log("wallet1", wallet?.address, "signer1", signers[0]?.address)
        console.log(`⚠️  The PRIVATE_KEY provided in the .env file doesn't match the first signer's address. Using the first rich wallet instead.`)
      }
    }
    return new Wallet(ZKSYNC_LOCAL_RICH_WALLETS[0].privateKey, getzkProvider())
  }
  else {
    return signers[0]
  }
}

export async function getRichWallets() {
  if (isZkSyncNetwork()) {
    return ZKSYNC_LOCAL_RICH_WALLETS.map(wallet => new Wallet(wallet.privateKey, getzkProvider()))
  }
  else {
    return await hardhatEthers.getSigners()
  }
}

export const getzkProvider = () => {
  const rpcUrl = hre.network.config.url
  if (!rpcUrl) throw `⛔️ RPC URL wasn't found in "${hre.network.name}"! Please add a "url" field to the network config in hardhat.config.ts`
  // Initialize zkSync Provider
  // const provider = ethers.getDefaultProvider(rpcUrl);
  const provider = new Provider(hre.network.config.url)
  return provider
}

export const getProvider = () => {
  if (isZkSyncNetwork()) {
    const rpcUrl = hre.network.config.url
    if (!rpcUrl) throw `⛔️ RPC URL wasn't found in "${hre.network.name}"! Please add a "url" field to the network config in hardhat.config.ts`
    // const provider = new Provider(hre.network.config.url)
    const provider = ethers.getDefaultProvider(rpcUrl)
    return provider
  }
  else {
    return hre.ethers.provider
  }
}

export const ZKSYNC_LOCAL_RICH_WALLETS = [
  {
    address: "0x36615Cf349d7F6344891B1e7CA7C72883F5dc049",
    privateKey: "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110",
  },
  {
    address: "0xa61464658AfeAf65CccaaFD3a512b69A83B77618",
    privateKey: "0xac1e735be8536c6534bb4f17f06f6afc73b2b5ba84ac2cfb12f7461b20c0bbe3",
  },
  {
    address: "0x0D43eB5B8a47bA8900d84AA36656c92024e9772e",
    privateKey: "0xd293c684d884d56f8d6abd64fc76757d3664904e309a0645baf8522ab6366d9e",
  },
  {
    address: "0xA13c10C0D5bd6f79041B9835c63f91de35A15883",
    privateKey: "0x850683b40d4a740aa6e745f889a6fdc8327be76e122f5aba645a5b02d0248db8",
  },
  {
    address: "0x8002cD98Cfb563492A6fB3E7C8243b7B9Ad4cc92",
    privateKey: "0xf12e28c0eb1ef4ff90478f6805b68d63737b7f33abfa091601140805da450d93",
  },
  {
    address: "0x4F9133D1d3F50011A6859807C837bdCB31Aaab13",
    privateKey: "0xe667e57a9b8aaa6709e51ff7d093f1c5b73b63f9987e4ab4aa9a5c699e024ee8",
  },
  {
    address: "0xbd29A1B981925B94eEc5c4F1125AF02a2Ec4d1cA",
    privateKey: "0x28a574ab2de8a00364d5dd4b07c4f2f574ef7fcc2a86a197f65abaec836d1959",
  },
  {
    address: "0xedB6F5B4aab3dD95C7806Af42881FF12BE7e9daa",
    privateKey: "0x74d8b3a188f7260f67698eb44da07397a298df5427df681ef68c45b34b61f998",
  },
  {
    address: "0xe706e60ab5Dc512C36A4646D719b889F398cbBcB",
    privateKey: "0xbe79721778b48bcc679b78edac0ce48306a8578186ffcb9f2ee455ae6efeace1",
  },
  {
    address: "0xE90E12261CCb0F3F7976Ae611A29e84a6A85f424",
    privateKey: "0x3eb15da85647edd9a1159a4a13b9e7c56877c4eb33f614546d4db06a51868b1c",
  },
]
