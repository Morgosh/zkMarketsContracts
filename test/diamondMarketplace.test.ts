// /* global describe it before */

// // const {
// //   getSelectors,
// //   FacetCutAction,
// //   removeSelectors,
// //   findAddressPositionInFacets
// // } = require('../scripts/libraries/diamond.ts')

// import { deployDiamond } from '../deploy/deploy_diamond_functions'
// import chai, { expect } from 'chai'
// // import ethers
// import { ethers as hardhatEthers } from 'hardhat'
// import { TypedDataDomain, ethers, Contract } from 'ethers'
// import { deployContract, getProvider, getRichWallets } from '../utils/utils'
// import { acceptOrder, acceptCollectionOfferOrder, callContractMethod, cancelOrder, createOffchainListingOrderWithApproval, createOffchainOfferOrderWithApproval, batchAcceptOrder, createOffchainOfferOrder } from '../../dapp/global/interact'
// import { customJsonStringify } from '../../dapp/global/utility'
// import { getSolidityTimeNow, getSolidityTimeTomorrow } from '../../dapp/global/time-utility'
// import { ItemType, OrderParameters, BasicOrderType } from '../../dapp/types/enums'

// // lets import abi from diamond
// import diamondAbi from '../abis/Diamond.abi.json'
// import ERC20ABI from '../abis/ERC20Template.abi.json'
// import { getOrderEIP712Data } from '../../dapp/global/interactGetters'

// // Listings and offers don't work the exact same way
// // since listings use native ETH and offers use ERC20 tokens
// // with ETH listings, there are some differences with how premium is handled, so when a user lists an nft FOR 1 eth for example, technically they always "pay 1% taker fee", so listing price != what they get
// // though with offers there is not the same issue, and the user does not need to pay 1% taker fee,
// // it would require a bit more complexity from the frontend for listings to send 0.99 instead of 1, but for now 1 seems a bit simplified

// // actually problem is that taker fee should come on top of the listing, so for example if it we're 1 eth, the take should pay 1.01, but due to simplification we let users pay 1 eth and we take 1% from the seller
// // I think every platform does it like this, so its not complicating the user experience

// declare global {
//   namespace Chai {
//     interface Assertion {
//       lteBigInt(value: bigint): Assertion
//     }
//   }
// }

// chai.Assertion.addMethod('lteBigInt', function (this: any, upper: bigint) {
//   const obj = this._obj as bigint
//   this.assert(
//     obj <= upper,
//     'expected #{this} to be less than or equal to #{exp}',
//     'expected #{this} to be above #{exp}',
//     upper.toString(),
//     obj.toString(),
//   )
// })

// describe('DiamondTest', async function () {
//   let marketplaceContract: Contract
//   let diamondAddress: string
//   let nftContract: any

//   let wallets: any[]
//   let wallet0: any
//   let provider: any

//   // let accounts: any[];
//   // accounts = await ethers.getSigners()

//   before(async function () {
//     provider = getProvider()
//     marketplaceContract = await deployDiamond()
//     // lets redifine the contract with all the facets
//     marketplaceContract = new Contract(await marketplaceContract.getAddress(), diamondAbi, provider)

//     diamondAddress = await marketplaceContract.getAddress()
//     await hardhatEthers.getContractAt('DiamondCutFacet', diamondAddress)
//     await hardhatEthers.getContractAt('DiamondLoupeFacet', diamondAddress)
//     await hardhatEthers.getContractAt('OwnershipFacet', diamondAddress)
//     wallets = await getRichWallets()
//     wallet0 = wallets[0]
//     // nft
//     nftContract = await deployNFTContract()
//   })

//   async function deployNFTContract() {
//     try {
//       const deployParams = [
//         'Scribes', // Name of the token, if it includes space its harder to verify, you could also test with quote marks it should work, but it doesnt
//         'SCR', // Symbol of the token
//         'ipfs://QmSQx4aRgj8x4mVP8jJajbChxL8Qexs1HB3dnspt5aHYbj', // Contract URI
//         1000, // Maximum supply of the token
//         ethers.parseEther('0.042').toString(), // Price per token during public minting
//         'https://zkmarkets.infura-ipfs.io/ipfs/Qmc7VZzy1CdKHmp74eH26BBCUPxdCQNVPNr5dFS4dJJAn8/', // Default base URI of the token metadata
//         'null', // URI of the token metadata when it is not yet revealed
//         '0xAA4306c1b90782Ce2710D9512beCD03168eaF7A2', // withdrawAddress
//         '0xAA4306c1b90782Ce2710D9512beCD03168eaF7A2', // _comissionRecipient
//         0, // _fixedCommisionTreshold WEI
//         500, // _comissionPercentageIn10000,
//         '0xAA4306c1b90782Ce2710D9512beCD03168eaF7A2', // _defaultRoyaltyRecipient
//         500, // _defaultRoyaltyPercentage in 10000 denominator
//       ]
//       return await deployContract('ERC721Template', deployParams)
//     }
//     catch (error) {
//       console.error('Error deploying contract')
//       console.error(error)
//       throw new Error('Error deploying contract')
//     }
//   }

//   // it('should have 5 facets -- call to facetAddresses function', async () => {
//   //   for (const address of await diamondLoupeFacet.facetAddresses() ) {
//   //     diamondAddresses.push(address)
//   //   }
//   //   assert.equal(diamondAddresses.length, 5)
//   // })

//   it('Admin mint should work for admin', async () => {
//     const tx = await nftContract.adminMint(wallets[0].address, 1)
//     const finishedTx = await tx.wait()
//     expect(finishedTx.status).to.eq(1)
//     expect(parseInt(await nftContract.totalSupply())).to.eq(1)
//     expect(parseInt(await nftContract.balanceOf(wallets[0].address))).to.eq(1)
//     expect(await nftContract.ownerOf(1)).to.eq(wallets[0].address)
//     const tx2 = await nftContract.adminMint(wallets[0].address, 10)
//     await tx2.wait()
//     expect(await nftContract.ownerOf(2)).to.eq(wallets[0].address)
//   })

//   let hash1: string
//   let signature1: string
//   let listingOrder1: OrderParameters
//   let hash2: string
//   let signature2: string
//   let listingOrder2: OrderParameters
//   let hash3: string
//   let signature3: string
//   let listingOrder3: OrderParameters

//   it('He should be able to create listing order for NFT 1', async () => {
//     const onchainDomain = await marketplaceContract.domain()
//     const network: any = await provider.getNetwork()
//     // Step 1: Define EIP-712 Domain
//     const domain: TypedDataDomain = {
//       name: 'zkMarkets',
//       version: '1',
//       chainId: network.chainId,
//       verifyingContract: await marketplaceContract.getAddress(),
//     }
//     expect(onchainDomain[0]).to.eq(domain.name)
//     expect(onchainDomain[1]).to.eq(domain.version)
//     expect(onchainDomain[2]).to.eq(domain.chainId)
//     expect(onchainDomain[3]).to.eq(domain.verifyingContract)

//     listingOrder1 = {
//       offerer: wallet0.address,
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 1,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('0.69'),
//       },
//       royaltyReceiver: wallet0.address,
//       royaltyPercentageIn10000: 100,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     const onchainOrderHash = await marketplaceContract.createOrderHash(listingOrder1)
//     const feOrderData = await getOrderEIP712Data(provider, listingOrder1, await marketplaceContract.getAddress())

//     // fe hash should match onchain hash
//     expect(feOrderData.hash).to.eq(onchainOrderHash)

//     // ok lets create a listing with approval
//     const res = await createOffchainListingOrderWithApproval(wallet0, listingOrder1, await marketplaceContract.getAddress())
//     hash1 = res.hash
//     signature1 = res.signature
//     const signatureVerified = await marketplaceContract.verifySignature(hash1, signature1, wallet0.address)
//     expect(signatureVerified).to.eq(true)

//     // listingOrder3 = {
//     //   offerer: wallet1.address,
//     //   orderType: BasicOrderType.ERC721_FOR_ETH,
//     //   offer: {
//     //     itemType: ItemType.NFT,
//     //     tokenAddress: await nftContract.getAddress(),
//     //     identifier: 3,
//     //     amount: BigInt(1)
//     //   },
//     //   consideration: {
//     //     itemType: ItemType.ETH,
//     //     tokenAddress: ethers.ZeroAddress,
//     //     identifier: 0,
//     //     amount: ethers.parseEther("0.69")
//     //   },
//     //   royaltyReceiver: wallet1.address,
//     //   royaltyPercentageIn10000: 100,
//     //   startTime: getSolidityTimeNow(),
//     //   endTime: getSolidityTimeTomorrow(),
//     //   createdTime: getSolidityTimeNow(),
//     // }
//     // const res3 = await createOffchainListingOrderWithApproval(wallet1, listingOrder3, await marketplaceContract.getAddress())
//     // hash3 = res3.hash
//     // signature3 = res3.signature
//     // const signatureVerified3 = await marketplaceContract.verifySignature(hash3, signature3, wallet1.address)
//     // expect(signatureVerified3).to.eq(true);
//   })

//   let balanceOfBuyerBefore: any
//   let balanceOfSellerBefore: any
//   it('A user should be able to buy NFT 1', async () => {
//     const signatureVerified = await marketplaceContract.verifySignature(hash1, signature1, wallet0.address)
//     expect(signatureVerified).to.eq(true)

//     balanceOfBuyerBefore = await provider.getBalance(wallets[1].address)
//     balanceOfSellerBefore = await provider.getBalance(wallets[0].address)
//     expect(await nftContract.ownerOf(1)).to.eq(wallets[0].address)
//     const finishedTx = await acceptOrder(wallets[1], listingOrder1, signature1, await marketplaceContract.getAddress())
//     expect(finishedTx!.status).to.eq(1)
//     expect(await nftContract.ownerOf(1)).to.eq(wallets[1].address)
//     try {
//       const marketplaceContractWithOwner = new ethers.Contract(
//         await marketplaceContract.getAddress(),
//         diamondAbi,
//         wallets[0],
//       )
//       await marketplaceContractWithOwner.validateOrder({
//         parameters: listingOrder1,
//         signature: signature1,
//       }, hash1)
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Order already claimed or canceled')
//     }
//   })

//   // ok now I will need to test if funds are transferring correctly

//   it('User 1 paid the correct amount', async () => {
//     const balanceOfBuyerAfter = await provider.getBalance(wallets[1].address)
//     const balanceOfSellerAfter = await provider.getBalance(wallets[0].address)
//     // to be less or equal to the balance before the transaction, remember he paid eth and gas fees (balanceOfUser1Before - listingOrder1.consideration.amount)
//     const lessThan = balanceOfBuyerBefore - listingOrder1.consideration.amount
//     // expect(balanceOfUser1After.toString()).to.be.lte(lessThan.toString())
//     expect(balanceOfBuyerAfter).to.lteBigInt(lessThan)
//     // check that platform fee is on the contract 2%
//     const platformFeeWei = listingOrder1.consideration.amount * BigInt(2) / BigInt(100)
//     // check that balance on contract
//     const balanceOnContract = await provider.getBalance(await marketplaceContract.getAddress())
//     expect(balanceOnContract).to.eq(platformFeeWei)

//     // check that seller got the correct amount
//     const expectedSellerAmount = listingOrder1.consideration.amount - platformFeeWei
//     expect(balanceOfSellerAfter).to.eq(balanceOfSellerBefore + expectedSellerAmount)
//   })

//   let premiumContract: any
//   let signature4: string
//   let listingOrder4: OrderParameters
//   // lets deploy another contract and it will be premium
//   it('Premium contract', async () => {
//     premiumContract = await deployNFTContract()
//     const tx = await premiumContract.adminMint(wallets[0].address, 2)
//     await tx.wait()
//     // set admin contract on marketplace
//     const marketplaceContractWithOwner = new ethers.Contract(
//       await marketplaceContract.getAddress(),
//       diamondAbi,
//       wallets[0],
//     )
//     const tx2 = await marketplaceContractWithOwner.setPremiumNftAddress(await premiumContract.getAddress())
//     await tx2.wait()
//     // getPremiumNftAddress
//     expect(await marketplaceContract.getPremiumNftAddress()).to.eq(await premiumContract.getAddress())
//     expect(await premiumContract.balanceOf(wallets[0].address)).to.eq(BigInt(2))
//     expect(await marketplaceContract.isPremiumHolder(wallets[0].address)).to.eq(true)
//     // generate random address
//     const randomRoyaltyAddress = ethers.Wallet.createRandom().address

//     // now lets sell nft4
//     listingOrder4 = {
//       offerer: wallet0.address,
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 4,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('1'),
//       },
//       royaltyReceiver: randomRoyaltyAddress,
//       royaltyPercentageIn10000: 200,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     const res = await createOffchainListingOrderWithApproval(wallet0, listingOrder4, await marketplaceContract.getAddress())
//     signature4 = res.signature

//     // snapshot balance of user 1
//     balanceOfSellerBefore = await provider.getBalance(wallets[0].address)

//     // lets buy the nft
//     await acceptOrder(wallets[1], listingOrder4, signature4, await marketplaceContract.getAddress())

//     // // balance should be + 1 eth - 1% platform fee - 2% royalty
//     const expectedSellerAmount = listingOrder4.consideration.amount
//       - (listingOrder4.consideration.amount * BigInt(1) / BigInt(100))
//       - (listingOrder4.consideration.amount * BigInt(listingOrder4.royaltyPercentageIn10000) / BigInt(10000))
//     // // check that seller got the correct amount
//     const balanceOfSellerAfter = await provider.getBalance(wallets[0].address)
//     expect(ethers.formatEther(balanceOfSellerAfter - balanceOfSellerBefore)).to.eq(ethers.formatEther(expectedSellerAmount))

//     // ok lets sell another nft where both buyer and seller are premium holders

//     // treansfer 1 premium first
//     const premiumContractWithOwner = new ethers.Contract(await premiumContract.getAddress(), diamondAbi, wallets[0])
//     const tx3 = await premiumContractWithOwner.transferFrom(wallets[0].address, wallets[1].address, 1)
//     await tx3.wait()

//     // lets make both wallets is premium holder
//     expect(await marketplaceContract.isPremiumHolder(wallets[0].address)).to.eq(true)
//     expect(await marketplaceContract.isPremiumHolder(wallets[1].address)).to.eq(true)

//     // now lets sell nft5

//     const listingOrder5 = {
//       offerer: wallet0.address,
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 5,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('1'),
//       },
//       royaltyReceiver: randomRoyaltyAddress,
//       royaltyPercentageIn10000: 200,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     const res5 = await createOffchainListingOrderWithApproval(wallet0, listingOrder5, await marketplaceContract.getAddress())
//     const signature5 = res5.signature

//     // lets snapshot balance on contract
//     const balanceOnContractBefore = await provider.getBalance(await marketplaceContract.getAddress())
//     // check balance of seller
//     const balanceOfSellerBefore2 = await provider.getBalance(wallets[0].address)
//     // lets buy the nft
//     expect(await marketplaceContract.isPremiumHolder(wallets[1].address)).to.eq(true)
//     await acceptOrder(wallets[1], listingOrder5, signature5, await marketplaceContract.getAddress())

//     // balance on contract should be same

//     const balanceOnContractAfter = await provider.getBalance(await marketplaceContract.getAddress())
//     const balanceOfSellerAfter2 = await provider.getBalance(wallets[0].address)
//     // expect balance of seller to be + 1 eth -1% (1% is always, 1% is saved due to premium) - 2% royalty
//     expect(ethers.formatEther(balanceOfSellerAfter2 - balanceOfSellerBefore2)).to.eq('0.97')
//     expect(ethers.formatEther(balanceOnContractAfter)).to.eq(ethers.formatEther(balanceOnContractBefore))
//   })

//   // also test cashback or premium
//   // lets go over all error cases

//   it('Invalid signature or incorrect signer', async () => {
//     try {
//       // change the listing order slightly
//       // listingOrder.startTime = getSolidityTimeTomorrow()
//       // first lets copy the listing order
//       const listingOrder2 = JSON.parse(customJsonStringify(listingOrder1))
//       listingOrder2.startTime = getSolidityTimeTomorrow()
//       await acceptOrder(wallets[1], listingOrder2, signature1, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Invalid signature or incorrect signer')
//     }
//   })

//   // claimed
//   it('Order already claimed or canceled - claimed', async () => {
//     try {
//       await acceptOrder(wallets[1], listingOrder1, signature1, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Order already claimed or canceled')
//     }
//   })

//   it('Order already claimed or canceled - canceled', async () => {
//     // lets create listing order 2
//     listingOrder2 = {
//       offerer: wallet0.address,
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 2,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('0.69'),
//       },
//       royaltyReceiver: wallet0.address,
//       royaltyPercentageIn10000: 100,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }
//     const res2 = await createOffchainListingOrderWithApproval(wallet0, listingOrder2, await marketplaceContract.getAddress())
//     hash2 = res2.hash
//     signature2 = res2.signature
//     const signatureVerified2 = await marketplaceContract.verifySignature(hash2, signature2, wallet0.address)
//     expect(signatureVerified2).to.eq(true)

//     const finishedTx = await cancelOrder(wallet0, listingOrder2, signature2, await marketplaceContract.getAddress())
//     expect(finishedTx!.status).to.eq(1)

//     // lets try to accept the order
//     try {
//       await acceptOrder(wallets[1], listingOrder2, signature2, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Order already claimed or canceled')
//     }
//   })

//   it('Order is not started yet', async () => {
//     // lets remake the listing order
//     listingOrder3 = {
//       offerer: wallet0.address,
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 3,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('0.69'),
//       },
//       royaltyReceiver: wallet0.address,
//       royaltyPercentageIn10000: 100,
//       startTime: getSolidityTimeTomorrow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }
//     const res3 = await createOffchainListingOrderWithApproval(wallet0, listingOrder3, await marketplaceContract.getAddress())
//     hash3 = res3.hash
//     signature3 = res3.signature
//     const signatureVerified3 = await marketplaceContract.verifySignature(hash3, signature3, wallet0.address)
//     expect(signatureVerified3).to.eq(true)

//     // lets try to accept the order
//     try {
//       await acceptOrder(wallets[1], listingOrder3, signature3, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Order is not started yet')
//     }
//   })

//   it('Order is expired', async () => {
//     listingOrder3.startTime = getSolidityTimeNow()
//     listingOrder3.endTime = getSolidityTimeNow()
//     const res3 = await createOffchainListingOrderWithApproval(wallet0, listingOrder3, await marketplaceContract.getAddress())
//     hash3 = res3.hash
//     signature3 = res3.signature
//     const signatureVerified4 = await marketplaceContract.verifySignature(hash3, signature3, wallet0.address)
//     expect(signatureVerified4).to.eq(true)

//     // sleep for 1 second
//     await new Promise(r => setTimeout(r, 1000))
//     // lets try to accept the order
//     try {
//       await acceptOrder(wallets[1], listingOrder3, signature3, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       // if it doesn't include order is expired lets log the error
//       if (!error.message.includes('Order is expired')) console.error(error)
//       expect(error.message).to.include('Order is expired')
//     }
//   })

//   it('NFT owner is not the offerer', async () => {
//     // lets create listing order 2
//     listingOrder3.offerer = wallets[2].address
//     listingOrder3.endTime = getSolidityTimeTomorrow()
//     const res3 = await createOffchainListingOrderWithApproval(wallets[2], listingOrder3, await marketplaceContract.getAddress())
//     hash3 = res3.hash
//     signature3 = res3.signature

//     const signatureVerified4 = await marketplaceContract.verifySignature(hash3, signature3, wallets[2].address)
//     expect(signatureVerified4).to.eq(true)
//     // lets try to accept the order
//     try {
//       await acceptOrder(wallets[1], listingOrder3, signature3, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('NFT owner is not the offerer')
//     }
//     listingOrder3.offerer = wallet0.address
//   })

//   it('Incorrect ETH value sent', async () => {
//     // lets just edit3
//     listingOrder3.endTime = getSolidityTimeTomorrow()
//     listingOrder3.offerer = wallet0.address
//     listingOrder3.consideration.amount = ethers.parseEther('0.69')
//     const res3 = await createOffchainListingOrderWithApproval(wallet0, listingOrder3, await marketplaceContract.getAddress())
//     hash3 = res3.hash
//     signature3 = res3.signature
//     const signatureVerified = await marketplaceContract.verifySignature(hash3, signature3, wallet0.address)
//     expect(signatureVerified).to.eq(true)

//     // lets try to accept the order
//     try {
//       const marketplaceContractWithSigner = new ethers.Contract(
//         await marketplaceContract.getAddress(),
//         diamondAbi,
//         wallets[1],
//       )
//       await callContractMethod(
//         marketplaceContractWithSigner as any,
//         'acceptOrder',
//         [
//           {
//             parameters: listingOrder3,
//             signature: signature3,
//           },
//           listingOrder3.royaltyPercentageIn10000,
//         ],
//         // orderParameters.consideration.amount,
//         listingOrder3.consideration.amount - BigInt(1),
//       )
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Incorrect ETH value sent')
//     }
//   })

//   // it("ETH transfer failed", async () => {
//   // });

//   // it("Taker premium cashback transfer failed", async () => {
//   // });

//   // it("Offerer premium cashback failed", async () => {
//   // });

//   // it("Royalty payment transfer failed", async () => {
//   // });

//   let ERC20Contract: any
//   // I also need to test offers
//   it('A user should be able to create offer for NFT 6', async () => {
//     // we should deploy a erc20 contract
//     ERC20Contract = await deployContract('ERC20Template', ['name', 'symbol'])

//     // lets mint 1 token
//     const tx1 = await ERC20Contract.adminMint(wallets[0].address, 1)
//     await tx1.wait()

//     // check who is owner of nft 6
//     // lets transfer nft 0 to user 1
//     const tx = await nftContract.transferFrom(wallets[0].address, wallets[1].address, 6)
//     await tx.wait()

//     expect(await nftContract.ownerOf(6)).to.eq(wallets[1].address)

//     const listingOrder6 = {
//       offerer: wallets[0].address.toLowerCase(),
//       orderType: BasicOrderType.ERC20_FOR_ERC721,
//       offer: {
//         itemType: ItemType.ERC20,
//         tokenAddress: await ERC20Contract.getAddress(),
//         identifier: 0,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 6,
//         amount: BigInt(1),
//       },
//       royaltyReceiver: wallets[0].address,
//       royaltyPercentageIn10000: 100,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     // a user should be able to
//     // balance of user 0 should be higher than 1 wei
//     // expect(BigInt(1)).to.be.lteBigInt(await ERC20Contract.balanceOf(wallets[0].address))

//     // lets console.log erc20 address and makretplace address
//     // lets test if user can accept the offer
//     const res = await createOffchainOfferOrderWithApproval(wallets[0], listingOrder6, await marketplaceContract.getAddress())
//     // const res = await createOffchainOfferOrder(wallets[0], listingOrder6, await marketplaceContract.getAddress())
//     const signature = res.signature

//     await acceptOrder(wallets[1], listingOrder6, signature, await marketplaceContract.getAddress())
//     // check that user 0 is owner of 6
//     expect(await nftContract.ownerOf(6)).to.eq(wallets[0].address)
//     // and balance of user 0 should be 1
//     expect(await ERC20Contract.balanceOf(wallets[0].address)).to.eq(BigInt(0))
//     // and balance of user 1 should be 0
//     expect(await ERC20Contract.balanceOf(wallets[1].address)).to.eq(BigInt(1))

//     // ok lets sent the token to random anddress
//     const randomAddress = ethers.Wallet.createRandom().address
//     const erc20ContractWithUser1 = new ethers.Contract(await ERC20Contract.getAddress(), ERC20ABI, wallets[1])
//     const tx3 = await erc20ContractWithUser1.transfer(randomAddress, 1)
//     await tx3.wait()
//   })

//   // ERC20_FOR_ERC721_ANY
//   it('A user should be able to create collection offer', async () => {
//     const randomRoyaltyAddress = ethers.Wallet.createRandom().address
//     const listingOrder7 = {
//       offerer: wallets[1].address.toLowerCase(),
//       orderType: BasicOrderType.ERC20_FOR_ERC721_ANY,
//       offer: {
//         itemType: ItemType.ERC20,
//         tokenAddress: await ERC20Contract.getAddress(),
//         identifier: 0,
//         amount: ethers.parseEther('1'),
//       },
//       consideration: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 0,
//         amount: BigInt(1),
//       },
//       royaltyReceiver: randomRoyaltyAddress,
//       royaltyPercentageIn10000: 200,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     // lets make allowance + order from user 1 to marketplace

//     try {
//       await createOffchainOfferOrderWithApproval(wallets[0], listingOrder7, await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       // "Offerer must be the signer"
//       expect(error.message).to.include('Offerer must be the signer')
//     }
//     const res = await createOffchainOfferOrder(wallets[1], listingOrder7, await marketplaceContract.getAddress())
//     const signature = res.signature
//     // check approval for erc20 now, it should be higher or equal to the amount

//     try {
//       await acceptCollectionOfferOrder(wallets[0], listingOrder7, signature, '7', await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Insufficient balance to complete transaction')
//     }

//     // lets mint erc20
//     const tx2 = await ERC20Contract.adminMint(wallets[1].address, ethers.parseEther('2'))
//     await tx2.wait()
//     // expect balance to be 2 eth
//     expect(await ERC20Contract.balanceOf(wallets[1].address)).to.eq(ethers.parseEther('2'))

//     // lets try to edit the approval to 0 and see if it fails
//     const erc20ContractWithUser1 = new ethers.Contract(await ERC20Contract.getAddress(), ERC20ABI, wallets[1])
//     const tx = await erc20ContractWithUser1.approve(await marketplaceContract.getAddress(), 0)
//     await tx.wait()

//     // lets make sure owner of 7 is wallet0
//     expect(await nftContract.ownerOf(7)).to.eq(wallets[0].address)

//     try {
//       await acceptCollectionOfferOrder(wallets[0], listingOrder7, signature, '7', await marketplaceContract.getAddress())
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Insufficient allowance to complete transaction')
//     }

//     await createOffchainOfferOrderWithApproval(wallets[1], listingOrder7, await marketplaceContract.getAddress())
//     expect(ethers.parseEther('1')).to.lteBigInt(await ERC20Contract.allowance(wallets[1].address, await marketplaceContract.getAddress()))

//     try {
//       const marketplaceContract2 = new ethers.Contract(await marketplaceContract.getAddress(), diamondAbi, wallets[0]) as any
//       await callContractMethod(
//         marketplaceContract2,
//         'acceptOrder',
//         [
//           {
//             parameters: listingOrder7,
//             signature,
//           },
//           listingOrder7.royaltyPercentageIn10000,
//         ],
//         null,
//       )
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       expect(error.message).to.include('Invalid order type')
//     }

//     // this one should revert because acceptOrder is not allowed for ERC20_FOR_ERC721_ANY

//     await acceptCollectionOfferOrder(wallets[0], listingOrder7, signature, '7', await marketplaceContract.getAddress())

//     // check new balance should be 1 eth
//     expect(await ERC20Contract.balanceOf(wallets[1].address)).to.eq(ethers.parseEther('1.01')) // he saves 1% platform fee due to being premium holder
//     // balance of seller should be 1 eth
//     expect(await ERC20Contract.balanceOf(wallets[0].address)).to.eq(ethers.parseEther('0.97')) // loses 2 % royalty but saves 1% platform fee but still has to pay 1 % platform fee (2% is total)
//     // balance on contract still 0 because both are premium holders
//     expect(await ERC20Contract.balanceOf(await marketplaceContract.getAddress())).to.eq(BigInt(0))
//     // and should be owner of 7
//     expect(await nftContract.ownerOf(7)).to.eq(wallets[1].address)
//   })

//   // function batchAcceptOrder(Order[] memory orders, uint256[] memory royaltyPercentagesIn10000) external payable whenNotPaused nonReentrant {
//   //     require(orders.length == royaltyPercentagesIn10000.length, "Orders and royalty percentages length mismatch");

//   //     // msg.value should be total of all orders order.consideration.amount
//   //     uint256 totalAmount = 0;
//   //     for (uint256 i = 0; i < orders.length; i++) {
//   //         totalAmount += orders[i].parameters.consideration.amount;
//   //     }
//   //     require(msg.value == totalAmount, "Incorrect ETH value sent");

//   //     // batch works only for ERC721_FOR_ETH orders
//   //     for (uint256 i = 0; i < orders.length; i++) {
//   //         require(orders[i].parameters.orderType == BasicOrderType.ERC721_FOR_ETH, "Invalid order type");
//   //         validateOrder(orders[i], royaltyPercentagesIn10000[i]);
//   //         handlePayments(orders[i].parameters);
//   //     }
//   // }
//   it('Batch accept order', async () => {
//     // Lets make sure owner of token 8 and 9 is wallet0
//     expect(await nftContract.ownerOf(8)).to.eq(wallets[0].address)
//     expect(await nftContract.ownerOf(9)).to.eq(wallets[0].address)
//     const listingOrder8 = {
//       offerer: wallets[0].address.toLowerCase(),
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 8,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('1'),
//       },
//       royaltyReceiver: wallets[0].address,
//       royaltyPercentageIn10000: 100,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     const listingOrder9 = {
//       offerer: wallets[0].address.toLowerCase(),
//       orderType: BasicOrderType.ERC721_FOR_ETH,
//       offer: {
//         itemType: ItemType.NFT,
//         tokenAddress: await nftContract.getAddress(),
//         identifier: 9,
//         amount: BigInt(1),
//       },
//       consideration: {
//         itemType: ItemType.ETH,
//         tokenAddress: ethers.ZeroAddress,
//         identifier: 0,
//         amount: ethers.parseEther('1'),
//       },
//       royaltyReceiver: wallets[0].address,
//       royaltyPercentageIn10000: 100,
//       startTime: getSolidityTimeNow(),
//       endTime: getSolidityTimeTomorrow(),
//       createdTime: getSolidityTimeNow(),
//     }

//     const res8 = await createOffchainListingOrderWithApproval(wallets[0], listingOrder8, await marketplaceContract.getAddress())
//     const signature8 = res8.signature
//     const res9 = await createOffchainListingOrderWithApproval(wallets[0], listingOrder9, await marketplaceContract.getAddress())
//     const signature9 = res9.signature

//     await batchAcceptOrder(wallets[1], [listingOrder8, listingOrder9], [signature8, signature9], [100, 100], await marketplaceContract.getAddress())

//     // check new balance should be 1 eth
//     expect(await nftContract.ownerOf(8)).to.eq(wallets[1].address)
//     expect(await nftContract.ownerOf(9)).to.eq(wallets[1].address)
//   })

//   // withdrawal from diamond erc20 and eth

//   it('Withdrawal of ERC20 from marketplace', async () => {
//     const balanceBefore = await ERC20Contract.balanceOf(wallets[0].address)
//     const balanceOnContractBefore = await ERC20Contract.balanceOf(await marketplaceContract.getAddress())
//     const marketplaceContractWithOwner = new ethers.Contract(await marketplaceContract.getAddress(), diamondAbi, wallets[0])
//     const tx = await marketplaceContractWithOwner.withdrawERC20(await ERC20Contract.getAddress())
//     await tx.wait()
//     const balanceAfter = await ERC20Contract.balanceOf(wallets[0].address)
//     expect(balanceAfter).to.eq(balanceBefore + balanceOnContractBefore)
//   })

//   // check that withdrawal does not work for non owner
//   it('Withdrawal of ERC20 from marketplace - not owner', async () => {
//     try {
//       const marketplaceContractWithOwner = new ethers.Contract(await marketplaceContract.getAddress(), diamondAbi, wallets[1])
//       const tx = await marketplaceContractWithOwner.withdrawERC20(await ERC20Contract.getAddress())
//       await tx.wait()
//       throw new Error('Should not reach here')
//     }
//     catch (error: any) {
//       // expect(error.message).to.include("NotContractOwner")
//       // for now lets just check that its not "Should not reach here"
//       expect(error.message).to.not.include('Should not reach here')
//     }
//   })

//   // check that eth withdrawal works
//   it('Withdrawal of ETH from marketplace', async () => {
//     // lets send on contract some eth from wallet 0
//     const tx1 = await wallets[0].sendTransaction({
//       to: await marketplaceContract.getAddress(),
//       value: ethers.parseEther('1'),
//     })
//     await tx1.wait()
//     const balanceBefore = await provider.getBalance(wallets[0].address)
//     const balanceOnContractBefore = await provider.getBalance(await marketplaceContract.getAddress())
//     // expect balance to be more than 0 eth
//     expect(1).to.lteBigInt(balanceOnContractBefore)
//     const marketplaceContractWithOwner = new ethers.Contract(await marketplaceContract.getAddress(), diamondAbi, wallets[0])
//     const tx = await marketplaceContractWithOwner.withdrawETH()
//     await tx.wait()
//     const balanceAfter = await provider.getBalance(wallets[0].address)
//     expect(balanceBefore).to.lteBigInt(balanceAfter - BigInt(1)) // cant predict exact due to gas
//   })
// })
