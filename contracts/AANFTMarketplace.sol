// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

// Core dependencies
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Utilities for signature validation
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title AA NFT Marketplace
 * @dev A decentralized platform for trading NFTs.
 * Supports Smart Accounts and gasless-listing operations.
 */
contract AANftMarketplace is ReentrancyGuard, Ownable, Pausable {

    // State variables
    mapping (bytes32 => bool) public claimed; // Tracks if a listing has been claimed
    address public premiumNftAddress;         // Address for premium NFTs
    uint256 public platformFee = 200;         // Platform fee in basis points (e.g., 200 means 2%)
    uint256 public premiumFee = 0;            // Fee for premium holders, initially 0%

    // Constants
    bytes private constant ETHEREUM_SIGNED_PREFIX = "\x19Ethereum Signed Message:\n32";
    bytes4 private constant EIP1271_SUCCESS_RETURN_VALUE = 0x1626ba7e;
    uint256 private constant MAX_FEE = 10000;  // Represented in basis points for fee calculations

    // Events to log various activities on the contract
    event ListingCanceled(address indexed seller, bytes32 indexed listingHash);
    event ItemBought(address indexed buyer, address indexed nftAddress, uint256 indexed tokenId, address seller, uint256 price);

    // Constructor for initializing any state
    constructor() {}

    /**
     * @notice Allows a buyer to purchase an NFT.
     * @param _signature The signature proving authenticity of the listing.
     * @param nftAddress Address of the NFT contract.
     * @param tokenId ID of the token being sold.
     * @param timestamp Timestamp when the NFT was listed.
     * @param collectionRoyaltyIn10000 Royalty fee for the NFT collection in basis points.
     */
    function buyItem(bytes memory _signature, address nftAddress, uint256 tokenId, uint256 timestamp, uint256 collectionRoyaltyIn10000) 
        external
        payable
        nonReentrant
        whenNotPaused
    {
        bytes32 listingHash = keccak256(abi.encodePacked(nftAddress, tokenId, msg.value, timestamp, collectionRoyaltyIn10000));

        // Validate that the NFT owner is the signer of the listing
        address nftOwnerAddress = IERC721(nftAddress).ownerOf(tokenId);
        require(verifySignature(listingHash, _signature, nftOwnerAddress), "Invalid signature or incorrect signer");
        
        require(!claimed[listingHash], "Listing already claimed");
        claimed[listingHash] = true;

        // Handle the transfer of funds and NFT
        handlePayments(nftOwnerAddress, msg.value, nftAddress, collectionRoyaltyIn10000);
        IERC721(nftAddress).transferFrom(nftOwnerAddress, msg.sender, tokenId);

        emit ItemBought(msg.sender, nftAddress, tokenId, nftOwnerAddress, msg.value);
    }

    /**
     * @notice Allows a seller to cancel their NFT listing.
     * @param _listingHash The unique hash of the NFT listing.
     * @param _cancelSignature The signature proving authenticity of the cancellation.
     * @param listerAddress Address of the seller.
     */
    function cancelListing(bytes32 _listingHash, bytes memory _cancelSignature, address listerAddress) external {
        require(!claimed[_listingHash], "Listing already claimed");
        
        // Validate the cancellation request
        bytes32 cancelHash = keccak256(abi.encodePacked(_listingHash, "cancel"));
        require(verifySignature(cancelHash, _cancelSignature, listerAddress), "Invalid signature or incorrect signer");
        
        claimed[_listingHash] = true;
        emit ListingCanceled(msg.sender, _listingHash);
    }

    // Administrative functions

    /**
     * @notice Allows the platform owner to update the platform fee.
     * @param newPlatformFee The new fee (in basis points).
     */
    function updatePlatformFee(uint256 newPlatformFee) external onlyOwner {
        require(newPlatformFee < MAX_FEE, "Platform fee out of bounds");
        platformFee = newPlatformFee;
    }

    /**
     * @notice Allows the platform owner to update the fee for premium holders.
     * @param newPremiumFee The new fee (in basis points).
     */
    function updatePremiumFee(uint256 newPremiumFee) external onlyOwner {
        require(newPremiumFee < MAX_FEE, "Premium fee out of bounds");
        premiumFee = newPremiumFee;
    }

    /**
     * @notice Allows the platform owner to update the address for premium NFTs.
     * @param newPremiumNftAddress The new premium NFT address.
     */
    function updatePremiumNftAddress(address newPremiumNftAddress) external onlyOwner {
        premiumNftAddress = newPremiumNftAddress;
    }

    /**
    * @notice Pauses the marketplace, preventing sales.
    */
    function pauseMarketplace() external onlyOwner {
        _pause();
    }

    /**
    * @notice Unpauses the marketplace, allowing sales.
    */
    function unpauseMarketplace() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Allows the platform owner to withdraw accumulated funds.
     */
    function withdrawAll() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner()).transfer(balance);
    }

    /**
     * @notice Checks if the contract supports Smart Accounts
     * @return Always returns true.
     */
    function isSACompatible() external pure returns (bool) {
        return true;
    }

    // Internal helper functions

    /**
     * @notice Check if a given user holds a premium NFT.
     * @param user The address of the user to check.
     * @return true if the user holds a premium NFT, false otherwise.
     */
    function isPremiumHolder(address user) internal view returns (bool) {
        IERC721 premiumNft = IERC721(premiumNftAddress);
        return premiumNft.balanceOf(user) > 0;
    }

    /**
     * @notice Distributes payments for a sold NFT.
     * @dev This includes fees for the platform, royalties, and the seller's proceeds.
     * @param seller The address of the NFT seller.
     * @param totalPrice The total price the NFT was sold for.
     * @param nftCollection Address of the NFT's contract.
     * @param collectionRoyaltyIn10000 The royalty fee for the NFT collection in basis points.
     */
    function handlePayments(address seller, uint256 totalPrice, address nftCollection, uint256 collectionRoyaltyIn10000) internal {
        uint256 platformCut;
        uint256 collectionOwnerCut;

        // Calculate the platform's cut. Reduced for premium sellers.
        uint256 effectivePlatformFee = (premiumNftAddress != address(0) && isPremiumHolder(seller)) ? premiumFee : platformFee;
        if(effectivePlatformFee > 0) {
            platformCut = (effectivePlatformFee * totalPrice) / 10000;
        }

        // Calculate royalty for the NFT collection.
        if(collectionRoyaltyIn10000 > 0) {
            collectionOwnerCut = (collectionRoyaltyIn10000 * totalPrice) / 10000;
            (bool collectionSuccess,) = payable(Ownable(nftCollection).owner()).call{value: collectionOwnerCut}("");
            require(collectionSuccess, "Collection owner transfer failed");
        }

        // Remaining amount is transferred to the seller.
        uint256 sellerCut = totalPrice - collectionOwnerCut - platformCut;
        (bool sellerSuccess,) = payable(seller).call{value: sellerCut}("");
        require(sellerSuccess, "Seller transfer failed");
    }

    /**
     * @notice Validates a signature against a listing's data.
     * @dev It uses EIP-1271 for contract-based accounts and ECDSA for EOA.
     * @param _hash The hash of the listing's data.
     * @param _signature The signature to validate.
     * @param signer The expected signer of the message.
     * @return true if the signature is valid, false otherwise.
     */
    function verifySignature(bytes32 _hash, bytes memory _signature, address signer) public view returns (bool) {
        
        // For contract accounts, we use EIP-1271's isValidSignature.
        if (isContract(signer)) {
            bytes4 magicValue = IERC1271(signer).isValidSignature(_hash, _signature);
            return magicValue == EIP1271_SUCCESS_RETURN_VALUE;
        }
        
        // For EOA accounts, we use ECDSA recover.
        bytes32 prefixedHash = keccak256(abi.encodePacked(ETHEREUM_SIGNED_PREFIX, _hash));
        address recoveredAddress = ECDSA.recover(prefixedHash, _signature);

        if (recoveredAddress == signer) {
            return true;
        }

        return false;
    }

    /**
     * @notice Checks if an address is a deployed contract.
     * @param account Address to check.
     * @return true if the address is a contract, false otherwise.
     */
    function isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly { size := extcodesize(account) }
        return size > 0;
    }
}
