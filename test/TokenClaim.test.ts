import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers";
import hre from "hardhat";
import { getRichWallets } from "../utils/utils";

const provider = new ethers.BrowserProvider(hre.network.provider as any);

// Helper function to create claim signature
async function createClaimSignature(
  approver: any,
  contract: any,
  user: string,
  tokenContract: string,
  tokenId: number,
  amount: string,
  nonce: number,
  tokenType: number
) {
  const network = await provider.getNetwork();
  const contractAddress = await contract.getAddress();
  
  const domain = {
    name: "TokenClaim",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: contractAddress
  };

  const types = {
    Claim: [
      { name: "user", type: "address" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "tokenType", type: "uint8" }
    ]
  };

  const value = {
    user: user,
    tokenContract: tokenContract,
    tokenId: tokenId,
    amount: amount,
    nonce: nonce,
    tokenType: tokenType
  };

  return await approver.signTypedData(domain, types, value);
}

describe("TokenClaim Contract Tests", () => {
  let tokenClaim: any;
  let mockERC20: any;
  let mockERC721: any;
  let mockERC1155: any;
  let deployer: any, user1: any, user2: any, approver: any;

  beforeEach(async () => {
    const wallets = await getRichWallets();
    deployer = wallets[0];
    user1 = wallets[1];
    user2 = wallets[2];
    approver = wallets[3];

    // Deploy mock tokens
    const mockERC20Artifact = await hre.artifacts.readArtifact("ERC20Template");
    const MockERC20 = new ethers.ContractFactory(mockERC20Artifact.abi, mockERC20Artifact.bytecode, deployer);
    mockERC20 = await MockERC20.deploy("Test Token", "TEST", 18, ethers.parseEther("10000"));
    await mockERC20.waitForDeployment();

    const mockERC721Artifact = await hre.artifacts.readArtifact("MockERC721");
    const MockERC721 = new ethers.ContractFactory(mockERC721Artifact.abi, mockERC721Artifact.bytecode, deployer);
    mockERC721 = await MockERC721.deploy("Test NFT", "TNFT");
    await mockERC721.waitForDeployment();

    const mockERC1155Artifact = await hre.artifacts.readArtifact("MockERC1155");
    const MockERC1155 = new ethers.ContractFactory(mockERC1155Artifact.abi, mockERC1155Artifact.bytecode, deployer);
    mockERC1155 = await MockERC1155.deploy();
    await mockERC1155.waitForDeployment();

    // Deploy TokenClaim contract
    const tokenClaimArtifact = await hre.artifacts.readArtifact("TokenClaim");
    const TokenClaim = new ethers.ContractFactory(tokenClaimArtifact.abi, tokenClaimArtifact.bytecode, deployer);
    tokenClaim = await TokenClaim.deploy(await approver.getAddress());
    await tokenClaim.waitForDeployment();

    console.log(`TokenClaim deployed at: ${await tokenClaim.getAddress()}`);
    console.log(`MockERC20 deployed at: ${await mockERC20.getAddress()}`);
    console.log(`MockERC721 deployed at: ${await mockERC721.getAddress()}`);
    console.log(`MockERC1155 deployed at: ${await mockERC1155.getAddress()}`);

    // Setup tokens in contract
    // Transfer ERC20 tokens to claim contract
    await mockERC20.connect(deployer).transfer(await tokenClaim.getAddress(), ethers.parseEther("1000"));
    
    // Mint ERC721 tokens to claim contract
    await mockERC721.connect(deployer).mint(await tokenClaim.getAddress(), 1);
    await mockERC721.connect(deployer).mint(await tokenClaim.getAddress(), 2);
    await mockERC721.connect(deployer).mint(await tokenClaim.getAddress(), 3);

    // Mint ERC1155 tokens to claim contract
    await mockERC1155.connect(deployer).mint(await tokenClaim.getAddress(), 1, 100, "0x");
    await mockERC1155.connect(deployer).mint(await tokenClaim.getAddress(), 2, 200, "0x");

    // Send some ETH to claim contract for rescue testing
    await deployer.sendTransaction({
      to: await tokenClaim.getAddress(),
      value: ethers.parseEther("1")
    });
  });

  describe("Basic Contract Tests", () => {
    it("Should deploy correctly", async () => {
      expect(await tokenClaim.approver()).to.equal(await approver.getAddress());
      expect(await mockERC20.balanceOf(await tokenClaim.getAddress())).to.equal(ethers.parseEther("1000"));
    });

  });

  describe("Claim Functions", () => {
    it("Should allow valid ERC20 claim", async () => {
      const amount = ethers.parseEther("100");
      const nonce = 1;
      const tokenType = 0; // ERC20

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC20.getAddress(),
        0, // tokenId = 0 for ERC20
        amount.toString(),
        nonce,
        tokenType
      );

      const balanceBefore = await mockERC20.balanceOf(await user1.getAddress());
      
      await tokenClaim.connect(user1).claimToken(
        await mockERC20.getAddress(),
        0, // tokenId
        amount,
        nonce,
        tokenType,
        signature
      );

      const balanceAfter = await mockERC20.balanceOf(await user1.getAddress());
      expect(balanceAfter - balanceBefore).to.equal(amount);
      expect(await tokenClaim.usedNonces(nonce)).to.be.true;
    });

    it("Should allow valid ERC721 claim", async () => {
      const tokenId = 1;
      const amount = 1;
      const nonce = 2;
      const tokenType = 1; // ERC721

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC721.getAddress(),
        tokenId,
        amount.toString(),
        nonce,
        tokenType
      );

      await tokenClaim.connect(user1).claimToken(
        await mockERC721.getAddress(),
        tokenId,
        amount,
        nonce,
        tokenType,
        signature
      );

      expect(await mockERC721.ownerOf(tokenId)).to.equal(await user1.getAddress());
      expect(await tokenClaim.usedNonces(nonce)).to.be.true;
    });

    it("Should allow valid ERC1155 claim", async () => {
      const tokenId = 1;
      const amount = 50;
      const nonce = 7;
      const tokenType = 2; // ERC1155

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC1155.getAddress(),
        tokenId,
        amount.toString(),
        nonce,
        tokenType
      );

      const balanceBefore = await mockERC1155.balanceOf(await user1.getAddress(), tokenId);

      await tokenClaim.connect(user1).claimToken(
        await mockERC1155.getAddress(),
        tokenId,
        amount,
        nonce,
        tokenType,
        signature
      );

      const balanceAfter = await mockERC1155.balanceOf(await user1.getAddress(), tokenId);
      expect(balanceAfter - balanceBefore).to.equal(amount);
      expect(await tokenClaim.usedNonces(nonce)).to.be.true;
    });

    it("Should reject used nonce", async () => {
      const amount = ethers.parseEther("50");
      const nonce = 3;
      const tokenType = 0; // ERC20

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC20.getAddress(),
        0,
        amount.toString(),
        nonce,
        tokenType
      );

      // First claim should work
      await tokenClaim.connect(user1).claimToken(
        await mockERC20.getAddress(),
        0,
        amount,
        nonce,
        tokenType,
        signature
      );

      // Second claim with same nonce should fail
      await expect(
        tokenClaim.connect(user1).claimToken(
          await mockERC20.getAddress(),
          0,
          amount,
          nonce,
          tokenType,
          signature
        )
      ).to.be.revertedWith("Nonce already used");
    });

    it("Should reject invalid signature", async () => {
      const amount = ethers.parseEther("100");
      const nonce = 4;
      const tokenType = 0; // ERC20

      // Create signature with wrong approver (user2 instead of approver)
      const invalidSignature = await createClaimSignature(
        user2, // wrong signer
        tokenClaim,
        await user1.getAddress(),
        await mockERC20.getAddress(),
        0,
        amount.toString(),
        nonce,
        tokenType
      );

      await expect(
        tokenClaim.connect(user1).claimToken(
          await mockERC20.getAddress(),
          0,
          amount,
          nonce,
          tokenType,
          invalidSignature
        )
      ).to.be.revertedWith("Invalid signature");
    });

    it("Should reject ERC721 claim with amount != 1", async () => {
      const tokenId = 2;
      const amount = 2;
      const nonce = 5;
      const tokenType = 1; // ERC721

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC721.getAddress(),
        tokenId,
        amount.toString(),
        nonce,
        tokenType
      );

      await expect(
        tokenClaim.connect(user1).claimToken(
          await mockERC721.getAddress(),
          tokenId,
          amount,
          nonce,
          tokenType,
          signature
        )
      ).to.be.revertedWith("Amount must be 1 for ERC721");
    });

    it("Should reject ERC20 claim with non-zero tokenId", async () => {
      const amount = ethers.parseEther("100");
      const nonce = 6;
      const tokenType = 0; // ERC20

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC20.getAddress(),
        1, // non-zero tokenId
        amount.toString(),
        nonce,
        tokenType
      );

      await expect(
        tokenClaim.connect(user1).claimToken(
          await mockERC20.getAddress(),
          1, // non-zero tokenId
          amount,
          nonce,
          tokenType,
          signature
        )
      ).to.be.revertedWith("TokenId must be 0 for ERC20");
    });
  });

  describe("Token Transfer Tests", () => {
    it("Should accept ERC20 token transfers", async () => {
      const transferAmount = ethers.parseEther("500");
      const contractBalanceBefore = await mockERC20.balanceOf(await tokenClaim.getAddress());
      
      await mockERC20.connect(deployer).transfer(await tokenClaim.getAddress(), transferAmount);
      
      const contractBalanceAfter = await mockERC20.balanceOf(await tokenClaim.getAddress());
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(transferAmount);
    });

    it("Should accept ERC721 token transfers", async () => {
      // First mint a new token to deployer
      await mockERC721.connect(deployer).mint(await deployer.getAddress(), 10);
      
      // Transfer to contract
      await mockERC721.connect(deployer).transferFrom(
        await deployer.getAddress(), 
        await tokenClaim.getAddress(), 
        10
      );
      
      expect(await mockERC721.ownerOf(10)).to.equal(await tokenClaim.getAddress());
    });

    it("Should accept ERC1155 token transfers", async () => {
      // First mint tokens to deployer
      await mockERC1155.connect(deployer).mint(await deployer.getAddress(), 5, 300, "0x");
      
      const contractBalanceBefore = await mockERC1155.balanceOf(await tokenClaim.getAddress(), 5);
      
      // Transfer to contract
      await mockERC1155.connect(deployer).safeTransferFrom(
        await deployer.getAddress(),
        await tokenClaim.getAddress(),
        5,
        100,
        "0x"
      );
      
      const contractBalanceAfter = await mockERC1155.balanceOf(await tokenClaim.getAddress(), 5);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(100);
    });

    it("Should accept ETH transfers", async () => {
      const transferAmount = ethers.parseEther("0.5");
      
      // Just verify the transaction doesn't revert (contract has receive function)
      await expect(
        deployer.sendTransaction({
          to: await tokenClaim.getAddress(),
          value: transferAmount
        })
      ).to.not.be.reverted;
      
      // Verify contract received the ETH
      const contractBalance = await provider.getBalance(await tokenClaim.getAddress());
      expect(contractBalance).to.be.gte(transferAmount);
    });

    it("Should allow claiming transferred ERC721 tokens", async () => {
      // Mint and transfer a token to the contract
      await mockERC721.connect(deployer).mint(await deployer.getAddress(), 20);
      await mockERC721.connect(deployer).transferFrom(
        await deployer.getAddress(), 
        await tokenClaim.getAddress(), 
        20
      );

      // Now claim it
      const tokenId = 20;
      const amount = 1;
      const nonce = 50;
      const tokenType = 1; // ERC721

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC721.getAddress(),
        tokenId,
        amount.toString(),
        nonce,
        tokenType
      );

      await tokenClaim.connect(user1).claimToken(
        await mockERC721.getAddress(),
        tokenId,
        amount,
        nonce,
        tokenType,
        signature
      );

      expect(await mockERC721.ownerOf(tokenId)).to.equal(await user1.getAddress());
    });

    it("Should allow claiming transferred ERC1155 tokens", async () => {
      // Mint and transfer tokens to the contract
      await mockERC1155.connect(deployer).mint(await deployer.getAddress(), 10, 500, "0x");
      await mockERC1155.connect(deployer).safeTransferFrom(
        await deployer.getAddress(),
        await tokenClaim.getAddress(),
        10,
        200,
        "0x"
      );

      // Now claim some of them
      const tokenId = 10;
      const amount = 75;
      const nonce = 51;
      const tokenType = 2; // ERC1155

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC1155.getAddress(),
        tokenId,
        amount.toString(),
        nonce,
        tokenType
      );

      const balanceBefore = await mockERC1155.balanceOf(await user1.getAddress(), tokenId);

      await tokenClaim.connect(user1).claimToken(
        await mockERC1155.getAddress(),
        tokenId,
        amount,
        nonce,
        tokenType,
        signature
      );

      const balanceAfter = await mockERC1155.balanceOf(await user1.getAddress(), tokenId);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });

  describe("Rescue Functions", () => {
    it("Should rescue ETH (owner only)", async () => {
      const rescueAmount = ethers.parseEther("0.5");
      
      // Just test that the function doesn't revert when called by owner
      await expect(
        tokenClaim.connect(deployer).rescueETH(rescueAmount)
      ).to.not.be.reverted;
      
      // Test that non-owner cannot call it
      await expect(
        tokenClaim.connect(user1).rescueETH(rescueAmount)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should rescue ERC20 tokens (owner only)", async () => {
      const rescueAmount = ethers.parseEther("200");
      const ownerBalanceBefore = await mockERC20.balanceOf(await deployer.getAddress());

      await tokenClaim.connect(deployer).rescueERC20(await mockERC20.getAddress(), rescueAmount);

      const ownerBalanceAfter = await mockERC20.balanceOf(await deployer.getAddress());
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(rescueAmount);
    });

    it("Should rescue ERC721 tokens (owner only)", async () => {
      const tokenId = 1;

      await tokenClaim.connect(deployer).rescueERC721(await mockERC721.getAddress(), tokenId);

      expect(await mockERC721.ownerOf(tokenId)).to.equal(await deployer.getAddress());
    });

    it("Should rescue ERC1155 tokens (owner only)", async () => {
      const tokenId = 1;
      const amount = 25;
      const ownerBalanceBefore = await mockERC1155.balanceOf(await deployer.getAddress(), tokenId);

      await tokenClaim.connect(deployer).rescueERC1155(await mockERC1155.getAddress(), tokenId, amount);

      const ownerBalanceAfter = await mockERC1155.balanceOf(await deployer.getAddress(), tokenId);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);
    });


    it("Should reject rescue from non-owner", async () => {
      const rescueAmount = ethers.parseEther("0.1");

      await expect(
        tokenClaim.connect(user1).rescueERC20(await mockERC20.getAddress(), rescueAmount)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        tokenClaim.connect(user1).rescueERC721(await mockERC20.getAddress(), 1)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        tokenClaim.connect(user1).rescueERC1155(await mockERC20.getAddress(), 1, 1)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should reject rescuing contract itself", async () => {
      await expect(
        tokenClaim.connect(deployer).rescueERC20(await tokenClaim.getAddress(), 100)
      ).to.be.revertedWith("no");
    });
  });

  describe("Admin Functions", () => {
    it("Should update approver (owner only)", async () => {
      const newApprover = await user2.getAddress();
      
      await tokenClaim.connect(deployer).setApprover(newApprover);
      
      expect(await tokenClaim.approver()).to.equal(newApprover);
    });

    it("Should reject approver update from non-owner", async () => {
      await expect(
        tokenClaim.connect(user1).setApprover(await user2.getAddress())
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should reject zero address approver", async () => {
      await expect(
        tokenClaim.connect(deployer).setApprover(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid approver");
    });
  });

  describe("Events", () => {
    it("Should emit TokenClaimed event", async () => {
      const amount = ethers.parseEther("100");
      const nonce = 100;
      const tokenType = 0; // ERC20

      const signature = await createClaimSignature(
        approver,
        tokenClaim,
        await user1.getAddress(),
        await mockERC20.getAddress(),
        0,
        amount.toString(),
        nonce,
        tokenType
      );

      await expect(
        tokenClaim.connect(user1).claimToken(
          await mockERC20.getAddress(),
          0,
          amount,
          nonce,
          tokenType,
          signature
        )
      ).to.emit(tokenClaim, "TokenClaimed")
        .withArgs(
          await user1.getAddress(),
          await mockERC20.getAddress(),
          0,
          amount,
          tokenType,
          nonce
        );
    });

    it("Should emit ApproverUpdated event", async () => {
      const newApprover = await user2.getAddress();
      const oldApprover = await approver.getAddress();

      await expect(
        tokenClaim.connect(deployer).setApprover(newApprover)
      ).to.emit(tokenClaim, "ApproverUpdated")
        .withArgs(oldApprover, newApprover);
    });
  });
});
