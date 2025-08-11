// import { expect } from "chai";
// import { ethers } from "hardhat";
// import { ERC721ACBasic } from "../typechain-types";
// import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
// import "@nomicfoundation/hardhat-chai-matchers";

// describe("ERC721ACBasic - Comprehensive Tests", function () {
//   let contract: ERC721ACBasic;
//   let owner: HardhatEthersSigner;
//   let approver: HardhatEthersSigner;
//   let user: HardhatEthersSigner;
//   let attacker: HardhatEthersSigner;
//   let mockERC20: any;

//   const MAX_SUPPLY = 10000;

//   beforeEach(async function () {
//     [owner, approver, user, attacker] = await ethers.getSigners();

//     const ERC721ACBasic = await ethers.getContractFactory("ERC721ACBasic");
//     contract = await ERC721ACBasic.deploy(
//       owner.address,
//       250, // 2.5% royalty
//       "Test Collection",
//       "TEST",
//       "https://api.test.com/metadata/",
//       approver.address,
//       MAX_SUPPLY
//     );
//     await contract.waitForDeployment();

//     // Create a simple mock ERC20 address for testing (we'll just test the revert)
//     mockERC20 = { getAddress: async () => ethers.ZeroAddress };
//   });

//   describe("Access Control - Only Owner Functions", function () {
//     const restrictedFunctions = [
//       "setDefaultRoyalty",
//       "setTokenRoyalty", 
//       "setBaseURI",
//       "setContractURI",
//       "setApprover",
//       "setMaxSupply",
//       "withdraw",
//       "withdrawERC20",
//       "batchMint"
//     ];

//     it("Should reject non-owner calls to all restricted functions", async function () {
//       // setDefaultRoyalty
//       await expect(
//         contract.connect(attacker).setDefaultRoyalty(attacker.address, 500)
//       ).to.be.reverted;

//       // setTokenRoyalty  
//       await expect(
//         contract.connect(attacker).setTokenRoyalty(1, attacker.address, 500)
//       ).to.be.reverted;

//       // setBaseURI
//       await expect(
//         contract.connect(attacker).setBaseURI("https://evil.com/")
//       ).to.be.reverted;

//       // setContractURI
//       await expect(
//         contract.connect(attacker).setContractURI("https://evil.com/contract")
//       ).to.be.reverted;

//       // setApprover
//       await expect(
//         contract.connect(attacker).setApprover(attacker.address)
//       ).to.be.reverted;

//       // setMaxSupply
//       await expect(
//         contract.connect(attacker).setMaxSupply(1000)
//       ).to.be.reverted;

//       // withdraw
//       await expect(
//         contract.connect(attacker).withdraw()
//       ).to.be.reverted;

//       // withdrawERC20
//       await expect(
//         contract.connect(attacker).withdrawERC20(await mockERC20.getAddress())
//       ).to.be.reverted;

//       // batchMint
//       await expect(
//         contract.connect(attacker).batchMint([user.address], [1])
//       ).to.be.reverted;
//     });

//     it("Should allow owner to call all restricted functions", async function () {
//       // setDefaultRoyalty
//       await expect(
//         contract.connect(owner).setDefaultRoyalty(owner.address, 500)
//       ).to.not.be.reverted;

//       // setBaseURI
//       await expect(
//         contract.connect(owner).setBaseURI("https://newbase.com/")
//       ).to.not.be.reverted;

//       // setContractURI
//       await expect(
//         contract.connect(owner).setContractURI("https://newcontract.com/")
//       ).to.not.be.reverted;

//       // setApprover
//       await expect(
//         contract.connect(owner).setApprover(user.address)
//       ).to.not.be.reverted;

//       // setMaxSupply
//       await expect(
//         contract.connect(owner).setMaxSupply(20000)
//       ).to.not.be.reverted;

//       // batchMint
//       await expect(
//         contract.connect(owner).batchMint([user.address], [1])
//       ).to.not.be.reverted;
//     });
//   });

//   describe("Signature Minting - All Error Cases", function () {
//     const saleId = 1;
//     const endTime = Math.floor(Date.now() / 1000) + 3600;
//     const maxMint = 5;
//     const pricePerToken = ethers.parseEther("0.1");

//     it("Should reject zero amount", async function () {
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 0, signature, {
//           value: 0
//         })
//       ).to.be.revertedWith("Amount must be greater than 0");
//     });

//     it("Should reject expired sale", async function () {
//       const expiredEndTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, expiredEndTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, expiredEndTime, maxMint, pricePerToken, 1, signature, {
//           value: pricePerToken
//         })
//       ).to.be.revertedWith("Sale has ended");
//     });

//     it("Should reject when exceeding max supply", async function () {
//       // First, reduce max supply to 5
//       await contract.connect(owner).setMaxSupply(5);

//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // Try to mint 6 tokens when max supply is 5
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 6, signature, {
//           value: pricePerToken * 6n
//         })
//       ).to.be.revertedWith("Exceeds max supply");
//     });

//     it("Should reject insufficient payment", async function () {
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // Send less ETH than required
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 2, signature, {
//           value: pricePerToken // Should be pricePerToken * 2
//         })
//       ).to.be.revertedWith("Insufficient payment");
//     });

//     it("Should reject overpayment", async function () {
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // Send more ETH than required
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 2, signature, {
//           value: pricePerToken * 3n // Should be pricePerToken * 2
//         })
//       ).to.be.revertedWith("Insufficient payment");
//     });

//     it("Should reject invalid signature", async function () {
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       // Sign with wrong signer
//       const signature = await attacker.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 1, signature, {
//           value: pricePerToken
//         })
//       ).to.be.revertedWith("Invalid signature");
//     });

//     it("Should reject signature for different user", async function () {
//       // Create signature for attacker but user tries to use it
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [attacker.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 1, signature, {
//           value: pricePerToken
//         })
//       ).to.be.revertedWith("Invalid signature");
//     });

//     it("Should reject exceeding max mint per sale", async function () {
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // First mint up to the limit
//       await contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, maxMint, signature, {
//         value: pricePerToken * BigInt(maxMint)
//       });

//       // Try to mint one more
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, 1, signature, {
//           value: pricePerToken
//         })
//       ).to.be.revertedWith("Exceeds max mint for this sale");
//     });

//     it("Should work with valid signature and exact payment", async function () {
//       const amount = 3;
//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//           value: pricePerToken * BigInt(amount)
//         })
//       )
//         .to.emit(contract, "MintWithSignature")
//         .withArgs(user.address, amount, message);

//       expect(await contract.balanceOf(user.address)).to.equal(amount);
//     });
//   });

//   describe("Withdrawal Functions", function () {
//     beforeEach(async function () {
//       // Send ETH to contract via minting
//       const saleId = 999;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 5;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 2;

//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//         value: pricePerToken * BigInt(amount)
//       });
//     });

//     it("Should allow owner to withdraw ETH", async function () {
//       const contractBalance = await ethers.provider.getBalance(await contract.getAddress());
//       expect(contractBalance).to.be.gt(0);

//       await expect(contract.connect(owner).withdraw()).to.not.be.reverted;
      
//       const newBalance = await ethers.provider.getBalance(await contract.getAddress());
//       expect(newBalance).to.equal(0);
//     });

//     it("Should reject withdrawal when no ETH", async function () {
//       // First withdraw all ETH
//       await contract.connect(owner).withdraw();
      
//       // Try to withdraw again
//       await expect(contract.connect(owner).withdraw())
//         .to.be.revertedWith("No ETH to withdraw");
//     });

//     it("Should reject non-owner withdrawal attempts", async function () {
//       await expect(contract.connect(attacker).withdraw()).to.be.reverted;
//       await expect(contract.connect(attacker).withdrawERC20(ethers.ZeroAddress)).to.be.reverted;
//     });

//     it("Should reject invalid token address for ERC20 withdrawal", async function () {
//       await expect(contract.connect(owner).withdrawERC20(ethers.ZeroAddress))
//         .to.be.revertedWith("Invalid token address");
//     });
//   });

//   describe("Reentrancy Protection Analysis", function () {
//     it("Mint function should be safe from reentrancy", async function () {
//       // The mint function:
//       // 1. Performs all checks first (CEI pattern)
//       // 2. Updates state (mintedByHash mapping) 
//       // 3. Calls _mint() which is internal
//       // 4. No external calls that could trigger reentrancy
//       // 5. No ETH transfers that could call back
      
//       // This test verifies the function completes successfully
//       const saleId = 1;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 5;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 2;

//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // Should complete without issues
//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//           value: pricePerToken * BigInt(amount)
//         })
//       ).to.not.be.reverted;

//       // State should be properly updated
//       expect(await contract.balanceOf(user.address)).to.equal(amount);
//       expect(await contract.getMintedAmount(user.address, saleId, endTime, maxMint, pricePerToken)).to.equal(amount);
//     });
//   });

//   describe("Edge Cases", function () {
//     it("Should handle max uint256 values gracefully", async function () {
//       const maxUint256 = ethers.MaxUint256;
      
//       // Should reject setting max supply to max uint256 if current supply exists
//       await contract.connect(owner).batchMint([user.address], [1]);
      
//       await expect(
//         contract.connect(owner).setMaxSupply(maxUint256)
//       ).to.not.be.reverted; // This should actually work since maxUint256 > current supply
//     });

//     it("Should handle zero price minting", async function () {
//       const saleId = 1;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 5;
//       const pricePerToken = 0; // Free mint
//       const amount = 2;

//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       await expect(
//         contract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//           value: 0 // No payment required
//         })
//       ).to.not.be.reverted;

//       expect(await contract.balanceOf(user.address)).to.equal(amount);
//     });
//   });
// });