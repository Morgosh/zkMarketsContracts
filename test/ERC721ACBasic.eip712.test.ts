import { expect } from "chai"
import { ethers } from "ethers"
import { deployContract } from "../utils/utils"
import { generateMintSignature } from "../scripts/generateMintSignature"

describe("ERC721ACBasic EIP-712 Signatures", function () {
  let contract: any
  let owner: any
  let approver: any
  let user: any
  let otherUser: any
  let contractAddress: string

  const MINT_PARAMS = {
    royaltyReceiver: "0x8F995E8961D2FF09d444aB4eC72d67f36aa2c8CC",
    royaltyFeeNumerator: 1000,
    name: "Test NFT",
    symbol: "TNFT",
    baseTokenURI: "https://api.test.com/metadata/",
    maxSupply: 10000
  }

  beforeEach(async function () {
    ;[owner, approver, user, otherUser] = await ethers.getSigners()

    const deployParams = [
      MINT_PARAMS.royaltyReceiver,
      MINT_PARAMS.royaltyFeeNumerator,
      MINT_PARAMS.name,
      MINT_PARAMS.symbol,
      MINT_PARAMS.baseTokenURI,
      approver.address,
      MINT_PARAMS.maxSupply
    ]

    contract = await deployContract("ERC721ACBasic", deployParams, { verify: false, doLog: false })
    contractAddress = await contract.getAddress()
  })

  describe("EIP-712 Signature Validation", function () {
    it("should validate correct EIP-712 signature", async function () {
      const saleId = 1
      const endTime = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      const maxMint = 5
      const pricePerToken = ethers.parseEther("0.1")
      const amount = 1

      // Create EIP-712 signature
      const domain = {
        name: MINT_PARAMS.name,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: contractAddress
      }

      const types = {
        Mint: [
          { name: "user", type: "address" },
          { name: "saleId", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "maxMint", type: "uint256" },
          { name: "pricePerToken", type: "uint256" }
        ]
      }

      const value = {
        user: user.address,
        saleId: saleId,
        endTime: endTime,
        maxMint: maxMint,
        pricePerToken: pricePerToken.toString()
      }

      const signature = await approver.signTypedData(domain, types, value)

      // Test mint with valid signature
      await expect(
        contract.connect(user).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          amount,
          signature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.not.be.reverted

      expect(await contract.totalSupply()).to.equal(amount)
      expect(await contract.balanceOf(user.address)).to.equal(amount)
    })

    it("should reject signature from wrong signer", async function () {
      const saleId = 1
      const endTime = Math.floor(Date.now() / 1000) + 3600
      const maxMint = 5
      const pricePerToken = ethers.parseEther("0.1")
      const amount = 1

      const domain = {
        name: MINT_PARAMS.name,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: contractAddress
      }

      const types = {
        Mint: [
          { name: "user", type: "address" },
          { name: "saleId", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "maxMint", type: "uint256" },
          { name: "pricePerToken", type: "uint256" }
        ]
      }

      const value = {
        user: user.address,
        saleId: saleId,
        endTime: endTime,
        maxMint: maxMint,
        pricePerToken: pricePerToken.toString()
      }

      // Sign with wrong signer (not approver)
      const signature = await otherUser.signTypedData(domain, types, value)

      await expect(
        contract.connect(user).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          amount,
          signature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.be.revertedWith("Invalid signature")
    })

    it("should reject signature for different user", async function () {
      const saleId = 1
      const endTime = Math.floor(Date.now() / 1000) + 3600
      const maxMint = 5
      const pricePerToken = ethers.parseEther("0.1")
      const amount = 1

      const domain = {
        name: MINT_PARAMS.name,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: contractAddress
      }

      const types = {
        Mint: [
          { name: "user", type: "address" },
          { name: "saleId", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "maxMint", type: "uint256" },
          { name: "pricePerToken", type: "uint256" }
        ]
      }

      // Create signature for otherUser
      const value = {
        user: otherUser.address,
        saleId: saleId,
        endTime: endTime,
        maxMint: maxMint,
        pricePerToken: pricePerToken.toString()
      }

      const signature = await approver.signTypedData(domain, types, value)

      // Try to use signature with different user
      await expect(
        contract.connect(user).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          amount,
          signature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.be.revertedWith("Invalid signature")
    })

    it("should reject signature with modified parameters", async function () {
      const saleId = 1
      const endTime = Math.floor(Date.now() / 1000) + 3600
      const maxMint = 5
      const pricePerToken = ethers.parseEther("0.1")
      const amount = 1

      const domain = {
        name: MINT_PARAMS.name,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: contractAddress
      }

      const types = {
        Mint: [
          { name: "user", type: "address" },
          { name: "saleId", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "maxMint", type: "uint256" },
          { name: "pricePerToken", type: "uint256" }
        ]
      }

      const value = {
        user: user.address,
        saleId: saleId,
        endTime: endTime,
        maxMint: maxMint,
        pricePerToken: pricePerToken.toString()
      }

      const signature = await approver.signTypedData(domain, types, value)

      // Try to use signature with different pricePerToken
      const differentPrice = ethers.parseEther("0.2")
      await expect(
        contract.connect(user).mint(
          saleId,
          endTime,
          maxMint,
          differentPrice, // Different price
          amount,
          signature,
          { value: differentPrice * BigInt(amount) }
        )
      ).to.be.revertedWith("Invalid signature")
    })

    it("should prevent replay attacks across different contracts", async function () {
      // Deploy second contract
      const deployParams2 = [
        MINT_PARAMS.royaltyReceiver,
        MINT_PARAMS.royaltyFeeNumerator,
        "Different NFT",
        "DNFT",
        MINT_PARAMS.baseTokenURI,
        approver.address,
        MINT_PARAMS.maxSupply
      ]

      const contract2 = await deployContract("ERC721ACBasic", deployParams2, { verify: false, doLog: false })
      const contract2Address = await contract2.getAddress()

      const saleId = 1
      const endTime = Math.floor(Date.now() / 1000) + 3600
      const maxMint = 5
      const pricePerToken = ethers.parseEther("0.1")
      const amount = 1

      // Create signature for first contract
      const domain1 = {
        name: MINT_PARAMS.name,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: contractAddress
      }

      const types = {
        Mint: [
          { name: "user", type: "address" },
          { name: "saleId", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "maxMint", type: "uint256" },
          { name: "pricePerToken", type: "uint256" }
        ]
      }

      const value = {
        user: user.address,
        saleId: saleId,
        endTime: endTime,
        maxMint: maxMint,
        pricePerToken: pricePerToken.toString()
      }

      const signature = await approver.signTypedData(domain1, types, value)

      // Signature should work on first contract
      await expect(
        contract.connect(user).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          amount,
          signature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.not.be.reverted

      // Same signature should NOT work on second contract (replay protection)
      await expect(
        contract2.connect(user).mint(
          saleId,
          endTime,
          maxMint,
          pricePerToken,
          amount,
          signature,
          { value: pricePerToken * BigInt(amount) }
        )
      ).to.be.revertedWith("Invalid signature")
    })
  })
})