// import { expect } from "chai";
// import { ethers } from "hardhat";
// import { ERC721ACBasic, MoodyMightsERC721AC, ERC20Template } from "../typechain-types";
// import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
// import "@nomicfoundation/hardhat-chai-matchers";

// describe("Withdrawal Functions", function () {
//   let basicContract: ERC721ACBasic;
//   let moodyContract: MoodyMightsERC721AC;
//   let mockERC20: ERC20Template;
//   let owner: HardhatEthersSigner;
//   let approver: HardhatEthersSigner;
//   let user: HardhatEthersSigner;
//   let attacker: HardhatEthersSigner;

//   const MAX_SUPPLY = 10000;

//   beforeEach(async function () {
//     [owner, approver, user, attacker] = await ethers.getSigners();

//     // Deploy ERC721ACBasic
//     const ERC721ACBasic = await ethers.getContractFactory("ERC721ACBasic");
//     basicContract = await ERC721ACBasic.deploy(
//       owner.address,
//       250, // 2.5% royalty
//       "Test Collection",
//       "TEST",
//       "https://api.test.com/metadata/",
//       approver.address,
//       MAX_SUPPLY
//     );
//     await basicContract.waitForDeployment();

//     // Deploy MoodyMightsERC721AC
//     const MoodyMightsERC721AC = await ethers.getContractFactory("MoodyMightsERC721AC");
//     moodyContract = await MoodyMightsERC721AC.deploy(
//       owner.address,
//       250,
//       "Moody Collection",
//       "MOODY",
//       "https://api.moody.com/metadata/"
//     );
//     await moodyContract.waitForDeployment();

//     // Deploy ERC20Template for testing
//     const ERC20Template = await ethers.getContractFactory("ERC20Template");
//     mockERC20 = await ERC20Template.deploy(
//       "Mock Token",
//       "MOCK",
//       18,
//       ethers.parseEther("1000000")
//     );
//     await mockERC20.waitForDeployment();
//   });

//   describe("ETH Withdrawal", function () {
//     beforeEach(async function () {
//       // Fund contracts with ETH via minting
//       const saleId = 1;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 10;
//       const pricePerToken = ethers.parseEther("0.1");
//       const amount = 5;

//       const message = ethers.solidityPackedKeccak256(
//         ["address", "uint256", "uint256", "uint256", "uint256"],
//         [user.address, saleId, endTime, maxMint, pricePerToken]
//       );
//       const signature = await approver.signMessage(ethers.getBytes(message));

//       // Fund ERC721ACBasic with ETH
//       await basicContract.connect(user).mint(saleId, endTime, maxMint, pricePerToken, amount, signature, {
//         value: pricePerToken * BigInt(amount)
//       });

//       // Fund MoodyMightsERC721AC with ETH (using batch mint and sending ETH separately won't work)
//       // So we'll send ETH to the contract owner and they'll send it to the contract via a different method
//       // Actually, let's just test with one contract since MoodyMights doesn't have payable mint
//     });

//     it("Should withdraw ETH from ERC721ACBasic", async function () {
//       const contractBalance = await ethers.provider.getBalance(await basicContract.getAddress());
//       expect(contractBalance).to.be.gt(0);

//       const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      
//       const tx = await basicContract.connect(owner).withdraw();
//       const receipt = await tx.wait();
//       const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

//       const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
//       const contractBalanceAfter = await ethers.provider.getBalance(await basicContract.getAddress());
      
//       // Contract should be empty
//       expect(contractBalanceAfter).to.equal(0);
      
//       // Owner should receive ETH minus gas costs
//       expect(ownerBalanceAfter).to.be.closeTo(
//         ownerBalanceBefore + contractBalance - gasUsed,
//         ethers.parseEther("0.01") // Allow for gas cost variance
//       );
//     });

//     it("Should revert when no ETH to withdraw", async function () {
//       // First withdraw all ETH
//       await basicContract.connect(owner).withdraw();
      
//       // Try to withdraw again
//       await expect(basicContract.connect(owner).withdraw())
//         .to.be.revertedWith("No ETH to withdraw");
//     });

//     it("Should reject non-owner ETH withdrawal", async function () {
//       await expect(basicContract.connect(attacker).withdraw())
//         .to.be.reverted;
      
//       await expect(moodyContract.connect(attacker).withdraw())
//         .to.be.reverted;
//     });
//   });

//   describe("ERC20 Withdrawal", function () {
//     beforeEach(async function () {
//       // Send tokens to both contracts
//       const tokenAmount = ethers.parseEther("100");
//       await mockERC20.transfer(await basicContract.getAddress(), tokenAmount);
//       await mockERC20.transfer(await moodyContract.getAddress(), tokenAmount);
//     });

//     it("Should withdraw ERC20 tokens from ERC721ACBasic", async function () {
//       const contractBalance = await mockERC20.balanceOf(await basicContract.getAddress());
//       const ownerBalanceBefore = await mockERC20.balanceOf(owner.address);

//       await basicContract.connect(owner).withdrawERC20(await mockERC20.getAddress());

//       const ownerBalanceAfter = await mockERC20.balanceOf(owner.address);
//       const contractBalanceAfter = await mockERC20.balanceOf(await basicContract.getAddress());

//       expect(contractBalanceAfter).to.equal(0);
//       expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + contractBalance);
//     });

//     it("Should withdraw ERC20 tokens from MoodyMightsERC721AC", async function () {
//       const contractBalance = await mockERC20.balanceOf(await moodyContract.getAddress());
//       const ownerBalanceBefore = await mockERC20.balanceOf(owner.address);

//       await moodyContract.connect(owner).withdrawERC20(await mockERC20.getAddress());

//       const ownerBalanceAfter = await mockERC20.balanceOf(owner.address);
//       const contractBalanceAfter = await mockERC20.balanceOf(await moodyContract.getAddress());

//       expect(contractBalanceAfter).to.equal(0);
//       expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + contractBalance);
//     });

//     it("Should revert when no tokens to withdraw", async function () {
//       // First withdraw all tokens
//       await basicContract.connect(owner).withdrawERC20(await mockERC20.getAddress());
      
//       // Try to withdraw again
//       await expect(basicContract.connect(owner).withdrawERC20(await mockERC20.getAddress()))
//         .to.be.revertedWith("No tokens to withdraw");
//     });

//     it("Should reject invalid token address", async function () {
//       await expect(basicContract.connect(owner).withdrawERC20(ethers.ZeroAddress))
//         .to.be.revertedWith("Invalid token address");
      
//       await expect(moodyContract.connect(owner).withdrawERC20(ethers.ZeroAddress))
//         .to.be.revertedWith("Invalid token address");
//     });

//     it("Should reject non-owner ERC20 withdrawal", async function () {
//       await expect(basicContract.connect(attacker).withdrawERC20(await mockERC20.getAddress()))
//         .to.be.reverted;
      
//       await expect(moodyContract.connect(attacker).withdrawERC20(await mockERC20.getAddress()))
//         .to.be.reverted;
//     });
//   });

//   describe("Complete Withdrawal Scenarios", function () {
//     beforeEach(async function () {
//       // Fund contracts with multiple mints to test accumulated funds
//       const saleId = 1;
//       const endTime = Math.floor(Date.now() / 1000) + 3600;
//       const maxMint = 10;
//       const pricePerToken = ethers.parseEther("0.1");

//       // Multiple users mint to accumulate more ETH
//       for (let i = 0; i < 3; i++) {
//         const message = ethers.solidityPackedKeccak256(
//           ["address", "uint256", "uint256", "uint256", "uint256"],
//           [user.address, saleId + i, endTime, maxMint, pricePerToken]
//         );
//         const signature = await approver.signMessage(ethers.getBytes(message));

//         await basicContract.connect(user).mint(saleId + i, endTime, maxMint, pricePerToken, 2, signature, {
//           value: pricePerToken * 2n
//         });
//       }

//       // Fund with multiple ERC20 tokens
//       await mockERC20.transfer(await basicContract.getAddress(), ethers.parseEther("300"));
//       await mockERC20.transfer(await moodyContract.getAddress(), ethers.parseEther("150"));
//     });

//     it("Should handle large ETH withdrawal", async function () {
//       const contractBalance = await ethers.provider.getBalance(await basicContract.getAddress());
//       expect(contractBalance).to.equal(ethers.parseEther("0.6")); // 3 mints * 2 tokens * 0.1 ETH

//       await expect(basicContract.connect(owner).withdraw()).to.not.be.reverted;
      
//       const finalBalance = await ethers.provider.getBalance(await basicContract.getAddress());
//       expect(finalBalance).to.equal(0);
//     });

//     it("Should handle large ERC20 withdrawal from both contracts", async function () {
//       const basicBalance = await mockERC20.balanceOf(await basicContract.getAddress());
//       const moodyBalance = await mockERC20.balanceOf(await moodyContract.getAddress());
      
//       expect(basicBalance).to.equal(ethers.parseEther("300"));
//       expect(moodyBalance).to.equal(ethers.parseEther("150"));

//       const ownerBalanceBefore = await mockERC20.balanceOf(owner.address);

//       // Withdraw from both contracts
//       await basicContract.connect(owner).withdrawERC20(await mockERC20.getAddress());
//       await moodyContract.connect(owner).withdrawERC20(await mockERC20.getAddress());

//       const ownerBalanceAfter = await mockERC20.balanceOf(owner.address);
//       expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + ethers.parseEther("450"));
//     });

//     it("Should handle mixed withdrawal scenarios", async function () {
//       // Withdraw ETH first
//       await basicContract.connect(owner).withdraw();
      
//       // Then withdraw ERC20
//       await basicContract.connect(owner).withdrawERC20(await mockERC20.getAddress());
      
//       // Verify both are empty
//       expect(await ethers.provider.getBalance(await basicContract.getAddress())).to.equal(0);
//       expect(await mockERC20.balanceOf(await basicContract.getAddress())).to.equal(0);
//     });
//   });

//   describe("Multiple Token Types", function () {
//     let token1: ERC20Template;
//     let token2: ERC20Template;

//     beforeEach(async function () {
//       // Deploy multiple ERC20 tokens
//       const ERC20Template = await ethers.getContractFactory("ERC20Template");
      
//       token1 = await ERC20Template.deploy("Token1", "TK1", 18, ethers.parseEther("1000000"));
//       await token1.waitForDeployment();
      
//       token2 = await ERC20Template.deploy("Token2", "TK2", 6, 1000000 * 10**6); // 6 decimals
//       await token2.waitForDeployment();

//       // Send different tokens to contract
//       await token1.transfer(await basicContract.getAddress(), ethers.parseEther("50"));
//       await token2.transfer(await basicContract.getAddress(), 50 * 10**6); // 50 tokens with 6 decimals
//     });

//     it("Should withdraw different ERC20 tokens separately", async function () {
//       const owner1BalanceBefore = await token1.balanceOf(owner.address);
//       const owner2BalanceBefore = await token2.balanceOf(owner.address);

//       // Withdraw token1
//       await basicContract.connect(owner).withdrawERC20(await token1.getAddress());
      
//       // Withdraw token2
//       await basicContract.connect(owner).withdrawERC20(await token2.getAddress());

//       const owner1BalanceAfter = await token1.balanceOf(owner.address);
//       const owner2BalanceAfter = await token2.balanceOf(owner.address);

//       expect(owner1BalanceAfter).to.equal(owner1BalanceBefore + ethers.parseEther("50"));
//       expect(owner2BalanceAfter).to.equal(owner2BalanceBefore + BigInt(50 * 10**6));
//     });
//   });
// });