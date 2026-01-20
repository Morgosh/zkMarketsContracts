// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
/// @title Token Claim Contract
/// @notice Allows users to claim ERC20, ERC721, or ERC1155 tokens with valid signatures
contract TokenClaim is Ownable, EIP712, ERC721Holder, ERC1155Holder {
    using ECDSA for bytes32;

    // Token types
    enum TokenType { ERC20, ERC721, ERC1155, thirdwebERC1155 }

    // EIP-712 type hashes
    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "Claim(address user,address tokenContract,uint256 tokenId,uint256 amount,uint256 nonce,uint8 tokenType,uint256 value)"
    );

    // State variables
    address public approver;
    mapping(uint256 => bool) public usedNonces;
    uint256 public referralFeeBps; // Referral fee in basis points (0-10000, where 10000 = 100%)

    // Events
    event TokenClaimed(
        address indexed user,
        address indexed tokenContract,
        uint256 tokenId,
        uint256 amount,
        TokenType tokenType,
        uint256 indexed nonce
    );
    event ApproverUpdated(address indexed oldApprover, address indexed newApprover);
    event ReferralFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event ReferralPaid(address indexed referrer, uint256 amount);

    constructor(address _approver) EIP712("TokenClaim", "1") {
        approver = _approver;
    }

    /// @notice Claim tokens with a valid signature
    /// @param tokenContract The contract address of the token
    /// @param tokenId Token ID (for ERC721/ERC1155, 0 for ERC20)
    /// @param amount Amount to claim (for ERC20/ERC1155, 1 for ERC721)
    /// @param nonce Unique nonce provided by backend
    /// @param tokenType Type of token (0=ERC20, 1=ERC721, 2=ERC1155)
    /// @param signature Valid signature from approver
    function claimToken(
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 nonce,
        TokenType tokenType,
        bytes calldata signature
    ) external payable {
        _claimTokenInternal(tokenContract, tokenId, amount, nonce, tokenType, signature, address(0));
    }

    /// @notice Claim tokens with a valid signature and pay referral fee to referrer
    /// @param tokenContract The contract address of the token
    /// @param tokenId Token ID (for ERC721/ERC1155, 0 for ERC20)
    /// @param amount Amount to claim (for ERC20/ERC1155, 1 for ERC721)
    /// @param nonce Unique nonce provided by backend
    /// @param tokenType Type of token (0=ERC20, 1=ERC721, 2=ERC1155)
    /// @param signature Valid signature from approver
    /// @param referrer Address to receive referral fee (ignored if address(0))
    function claimTokenReferral(
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 nonce,
        TokenType tokenType,
        bytes calldata signature,
        address referrer
    ) external payable {
        _claimTokenInternal(tokenContract, tokenId, amount, nonce, tokenType, signature, referrer);
    }

    /// @notice Internal claim logic shared by claimToken and claimTokenReferral
    function _claimTokenInternal(
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 nonce,
        TokenType tokenType,
        bytes calldata signature,
        address referrer
    ) private {
        require(tokenContract != address(0), "Invalid token contract");
        require(amount > 0, "Amount must be greater than 0");
        require(!usedNonces[nonce], "Nonce already used");
        require(_validateSignature(tokenContract, tokenId, amount, nonce, tokenType, msg.value, signature), "Invalid signature");

        // Mark nonce as used
        usedNonces[nonce] = true;

        // Pay referral fee from msg.value if referrer is set
        if (referrer != address(0) && referralFeeBps > 0 && msg.value > 0) {
            uint256 referralAmount = (msg.value * referralFeeBps) / 10000;
            if (referralAmount > 0) {
                (bool ok, ) = referrer.call{value: referralAmount}("");
                require(ok, "Referral payment failed");
                emit ReferralPaid(referrer, referralAmount);
            }
        }

        // Transfer tokens based on type
        if (tokenType == TokenType.ERC20) {
            require(tokenId == 0, "TokenId must be 0 for ERC20");
            IERC20(tokenContract).transfer(msg.sender, amount);
        } else if (tokenType == TokenType.ERC721) {
            require(amount == 1, "Amount must be 1 for ERC721");
            IERC721(tokenContract).transferFrom(address(this), msg.sender, tokenId);
        } else if (tokenType == TokenType.ERC1155) {
            IERC1155(tokenContract).safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        } else if (tokenType == TokenType.thirdwebERC1155) {
            // Call authorizedMint for thirdweb ERC1155 contracts
            (bool success, ) = tokenContract.call(
                abi.encodeWithSignature("authorizedMint(address,uint256,uint256)", msg.sender, tokenId, amount)
            );
            require(success, "Authorized mint failed");
        }

        emit TokenClaimed(msg.sender, tokenContract, tokenId, amount, tokenType, nonce);
    }

    /// @notice Validate signature for claim
    function _validateSignature(
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 nonce,
        TokenType tokenType,
        uint256 value,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(
            CLAIM_TYPEHASH,
            msg.sender,
            tokenContract,
            tokenId,
            amount,
            nonce,
            uint8(tokenType),
            value
        ));
        
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        
        return signer == approver;
    }

    /// @notice Update approver address (owner only)
    function setApprover(address newApprover) external onlyOwner {
        require(newApprover != address(0), "Invalid approver");
        address oldApprover = approver;
        approver = newApprover;
        emit ApproverUpdated(oldApprover, newApprover);
    }

    /// @notice Update referral fee (owner only)
    /// @param newFeeBps New fee in basis points (0-10000, where 10000 = 100%)
    function setReferralFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 10000, "Fee cannot exceed 100%");
        uint256 oldFeeBps = referralFeeBps;
        referralFeeBps = newFeeBps;
        emit ReferralFeeUpdated(oldFeeBps, newFeeBps);
    }

    // rescue
    function rescueETH(uint256 amount) external onlyOwner {
        (bool ok,) = owner().call{value: amount}("");
        require(ok, "rescue fail");
    }
    
    function rescueERC20(address token, uint256 amount) external onlyOwner {
        require(token != address(this), "no");
        IERC20(token).transfer(owner(), amount);
    }
    
    function rescueERC721(address token, uint256 tokenId) external onlyOwner {
        IERC721(token).transferFrom(address(this), owner(), tokenId);
    }
    
    function rescueERC1155(address token, uint256 tokenId, uint256 amount) external onlyOwner {
        IERC1155(token).safeTransferFrom(address(this), owner(), tokenId, amount, "");
    }

    /// @notice Allow contract to receive ETH
    receive() external payable {}
}
