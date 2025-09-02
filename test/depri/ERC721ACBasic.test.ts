// import { expect } from "chai";
// import { ethers } from "hardhat";
// import { ERC721ACBasic } from "../typechain-types";
// import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
// import "@nomicfoundation/hardhat-chai-matchers";

// describe("ERC721ACBasic", function () {
//   let contract: ERC721ACBasic;
//   let owner: HardhatEthersSigner;
//   let approver: HardhatEthersSigner;
//   let user: HardhatEthersSigner;
//   let addr1: HardhatEthersSigner;

//   const MAX_SUPPLY = 10000;

//   beforeEach(async function () {
//     [owner, approver, user, addr1] = await ethers.getSigners();

//     const ERC721ACBasic = await ethers.getContractFactory("ERC721ACBasic");
//     contract = await ERC721ACBasic.deploy(
//       owner.address, // royalty receiver
//       250, // 2.5% royalty
//       "Test Collection",
//       "TEST",
//       "https://api.test.com/metadata/",
//       approver.address,
//       MAX_SUPPLY
//     );
//     await contract.waitForDeployment();
//   });

//   describe("Signature-based minting", function () {
//     it("Should mint with valid signature", async function () {
//       const saleId = 1;
//       const endTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
//       const maxMint = 5;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 3;

//       // Create signature
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const messageHash = ethers.hashMessage(ethers.getBytes(message));
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // Mint tokens
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//           value: pricePerToken * BigInt(amount)
//         })
//       )
//         .to.emit(contract, "MintWithSignature")
//         .withArgs(user.address, amount, message);

//       // Check balance
//       expect(await contract.balanceOf(user.address)).to.equal(3);
      
//       // Check minted amount
//       expect(await contract.getMintedAmount(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(3);
//       expect(await contract.getRemainingMints(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(2);
//     });

//     it("Should reject invalid signature", async function () {
//       const saleId = 2;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 3;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 2;

//       // Create signature with wrong signer
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await owner.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//           value: pricePerToken * BigInt(amount)
//         })
//       ).to.be.revertedWith("Invalid signature");
//     });

//     it("Should allow partial mints and track remaining", async function () {
//       const saleId = 3;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 5;
//       const pricePerToken = ethers.parseEther("0.1");

//       // Create signature
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // First mint: 2 tokens
//       await contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 2, signature, {
//         value: pricePerToken * 2n
//       });

//       expect(await contract.balanceOf(user.address)).to.equal(2);
//       expect(await contract.getMintedAmount(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(2);
//       expect(await contract.getRemainingMints(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(3);

//       // Second mint: 3 more tokens (should work)
//       await contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 3, signature, {
//         value: pricePerToken * 3n
//       });

//       expect(await contract.balanceOf(user.address)).to.equal(5);
//       expect(await contract.getMintedAmount(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(5);
//       expect(await contract.getRemainingMints(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(0);

//       // Third mint: 1 more token (should fail)
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 1, signature, {
//           value: pricePerToken
//         })
//       ).to.be.revertedWith("Exceeds max mint for this sale");
//     });

//     it("Should reject expired signature", async function () {
//       const saleId = 4;
//       const endTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago (expired)
//       const maxMint = 3;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 1;

//       // Create signature
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//           value: pricePerToken
//         })
//       ).to.be.revertedWith("Sale has ended");
//     });
//   });

//   describe("Approver management", function () {
//     it("Should allow owner to change approver", async function () {
//       await expect(contract.connect(owner).setApprover(addr1.address))
//         .to.emit(contract, "ApproverUpdated")
//         .withArgs(approver.address, addr1.address);

//       expect(await contract.approver()).to.equal(addr1.address);
//     });

//     it("Should reject zero address as approver", async function () {
//       await expect(contract.connect(owner).setApprover(ethers.ZeroAddress))
//         .to.be.revertedWith("Invalid approver address");
//     });
//   });

//   describe("Max supply management", function () {
//     it("Should allow owner to change max supply", async function () {
//       const newMaxSupply = 20000;
//       await expect(contract.connect(owner).setMaxSupply(newMaxSupply))
//         .to.emit(contract, "MaxSupplyUpdated")
//         .withArgs(MAX_SUPPLY, newMaxSupply);

//       expect(await contract.maxSupply()).to.equal(newMaxSupply);
//     });

//     it("Should reject max supply less than current supply", async function () {
//       // First mint some tokens
//       const saleId = 10;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 100;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 50;

//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//         value: pricePerToken * BigInt(amount)
//       });

//       // Try to set max supply less than current supply
//       await expect(contract.connect(owner).setMaxSupply(25))
//         .to.be.revertedWith("Max supply cannot be less than current supply");
//     });
//   });
// });