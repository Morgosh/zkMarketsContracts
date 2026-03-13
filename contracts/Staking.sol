// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @title Staking Contract
/// @notice Allows users to stake ERC721 and ERC1155 NFTs from whitelisted collections. Rewards handled off-chain via API.
contract Staking is OwnableUpgradeable, UUPSUpgradeable, ERC721Holder, ERC1155Holder {

    // ------------------------------
    // Storage (append-only for upgrades)
    // ------------------------------
    mapping(address => bool) public allowedCollections;
    mapping(address => mapping(uint256 => address)) public staker; // collection => tokenId => staker (ERC721)
    mapping(address => mapping(uint256 => uint256)) public stakedAt; // collection => tokenId => timestamp
    uint256 public minStakeDuration; // minimum seconds before unstaking is allowed

    // ERC1155 staking storage
    // collection => tokenId => user => staked amount
    mapping(address => mapping(uint256 => mapping(address => uint256))) public stakedERC1155Amount;
    // collection => tokenId => user => timestamp
    mapping(address => mapping(uint256 => mapping(address => uint256))) public stakedERC1155At;

    // Per-collection min stake duration (overrides global if set)
    mapping(address => uint256) public collectionMinStakeDuration;
    mapping(address => bool) public collectionMinStakeDurationSet; // true = use per-collection value

    // ------------------------------
    // Events
    // ------------------------------
    event Staked(address indexed user, address indexed collection, uint256 tokenId, uint256 timestamp);
    event Unstaked(address indexed user, address indexed collection, uint256 tokenId, uint256 timestamp);
    event StakedERC1155(address indexed user, address indexed collection, uint256 tokenId, uint256 amount, uint256 timestamp);
    event UnstakedERC1155(address indexed user, address indexed collection, uint256 tokenId, uint256 amount, uint256 timestamp);
    event CollectionUpdated(address indexed collection, bool allowed);
    event MinStakeDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event CollectionMinStakeDurationUpdated(address indexed collection, uint256 duration, bool isSet);

    // ------------------------------
    // Initializer (replaces constructor)
    // ------------------------------
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    // ------------------------------
    // UUPS
    // ------------------------------
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ------------------------------
    // Internal helpers
    // ------------------------------

    /// @dev Returns the effective min stake duration for a collection (per-collection if set, else global)
    function getEffectiveMinStakeDuration(address collection) public view returns (uint256) {
        if (collectionMinStakeDurationSet[collection]) {
            return collectionMinStakeDuration[collection];
        }
        return minStakeDuration;
    }

    // ------------------------------
    // ERC721 Staking
    // ------------------------------

    /// @notice Stake one or more ERC721 NFTs from an allowed collection
    /// @param collection The NFT collection address
    /// @param tokenIds Array of token IDs to stake
    function stake(address collection, uint256[] calldata tokenIds) external {
        require(allowedCollections[collection], "Collection not allowed");
        require(tokenIds.length > 0, "No token IDs provided");

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            IERC721(collection).transferFrom(msg.sender, address(this), tokenId);

            staker[collection][tokenId] = msg.sender;
            stakedAt[collection][tokenId] = block.timestamp;

            emit Staked(msg.sender, collection, tokenId, block.timestamp);
        }
    }

    /// @notice Unstake one or more ERC721 NFTs
    /// @param collection The NFT collection address
    /// @param tokenIds Array of token IDs to unstake
    function unstake(address collection, uint256[] calldata tokenIds) external {
        require(tokenIds.length > 0, "No token IDs provided");

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(staker[collection][tokenId] == msg.sender, "Not staker");
            uint256 _duration = getEffectiveMinStakeDuration(collection);
            require(_duration == 0 || block.timestamp >= stakedAt[collection][tokenId] + _duration, "Min stake duration not met");

            delete staker[collection][tokenId];
            delete stakedAt[collection][tokenId];

            IERC721(collection).transferFrom(address(this), msg.sender, tokenId);

            emit Unstaked(msg.sender, collection, tokenId, block.timestamp);
        }
    }

    // ------------------------------
    // ERC1155 Staking
    // ------------------------------

    /// @notice Stake ERC1155 tokens from an allowed collection
    /// @param collection The ERC1155 collection address
    /// @param tokenId The token ID to stake
    /// @param amount The amount to stake
    function stakeERC1155(address collection, uint256 tokenId, uint256 amount) external {
        require(allowedCollections[collection], "Collection not allowed");
        require(amount > 0, "Amount must be > 0");

        IERC1155(collection).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        stakedERC1155Amount[collection][tokenId][msg.sender] += amount;
        stakedERC1155At[collection][tokenId][msg.sender] = block.timestamp;

        emit StakedERC1155(msg.sender, collection, tokenId, amount, block.timestamp);
    }

    /// @notice Batch stake multiple ERC1155 token types from an allowed collection
    /// @param collection The ERC1155 collection address
    /// @param tokenIds Array of token IDs to stake
    /// @param amounts Array of amounts to stake per token ID
    function batchStakeERC1155(address collection, uint256[] calldata tokenIds, uint256[] calldata amounts) external {
        require(allowedCollections[collection], "Collection not allowed");
        require(tokenIds.length == amounts.length, "Arrays length mismatch");
        require(tokenIds.length > 0, "Empty arrays");

        IERC1155(collection).safeBatchTransferFrom(msg.sender, address(this), tokenIds, amounts, "");

        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(amounts[i] > 0, "Amount must be > 0");
            stakedERC1155Amount[collection][tokenIds[i]][msg.sender] += amounts[i];
            stakedERC1155At[collection][tokenIds[i]][msg.sender] = block.timestamp;

            emit StakedERC1155(msg.sender, collection, tokenIds[i], amounts[i], block.timestamp);
        }
    }

    /// @notice Unstake ERC1155 tokens
    /// @param collection The ERC1155 collection address
    /// @param tokenId The token ID to unstake
    /// @param amount The amount to unstake
    function unstakeERC1155(address collection, uint256 tokenId, uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(stakedERC1155Amount[collection][tokenId][msg.sender] >= amount, "Insufficient staked amount");
        uint256 _duration = getEffectiveMinStakeDuration(collection);
        require(_duration == 0 || block.timestamp >= stakedERC1155At[collection][tokenId][msg.sender] + _duration, "Min stake duration not met");

        stakedERC1155Amount[collection][tokenId][msg.sender] -= amount;

        if (stakedERC1155Amount[collection][tokenId][msg.sender] == 0) {
            delete stakedERC1155At[collection][tokenId][msg.sender];
        }

        IERC1155(collection).safeTransferFrom(address(this), msg.sender, tokenId, amount, "");

        emit UnstakedERC1155(msg.sender, collection, tokenId, amount, block.timestamp);
    }

    // ------------------------------
    // Views
    // ------------------------------

    /// @notice Check if a specific ERC721 token is currently staked
    function isStaked(address collection, uint256 tokenId) external view returns (bool) {
        return staker[collection][tokenId] != address(0);
    }

    /// @notice Get ERC721 staking info for a token
    function getStakeInfo(address collection, uint256 tokenId) external view returns (address stakerAddress, uint256 timestamp) {
        return (staker[collection][tokenId], stakedAt[collection][tokenId]);
    }

    /// @notice Get ERC1155 staked amount for a user
    function getERC1155StakeInfo(address collection, uint256 tokenId, address user) external view returns (uint256 amount, uint256 timestamp) {
        return (stakedERC1155Amount[collection][tokenId][user], stakedERC1155At[collection][tokenId][user]);
    }

    /// @notice Batch get ERC1155 staked amounts for a user across multiple token IDs
    /// @param collection The ERC1155 collection address
    /// @param tokenIds Array of token IDs to query (any order, non-sequential OK)
    /// @param user The user address
    function getERC1155StakeInfoBatch(address collection, uint256[] calldata tokenIds, address user) external view returns (uint256[] memory amounts, uint256[] memory timestamps) {
        amounts = new uint256[](tokenIds.length);
        timestamps = new uint256[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            amounts[i] = stakedERC1155Amount[collection][tokenIds[i]][user];
            timestamps[i] = stakedERC1155At[collection][tokenIds[i]][user];
        }
    }

    // ------------------------------
    // Admin
    // ------------------------------

    /// @notice Add or remove an allowed collection (works for both ERC721 and ERC1155)
    function setAllowedCollection(address collection, bool allowed) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        allowedCollections[collection] = allowed;
        emit CollectionUpdated(collection, allowed);
    }

    /// @notice Set global minimum staking duration before unstaking is allowed
    function setMinStakeDuration(uint256 newDuration) external onlyOwner {
        uint256 oldDuration = minStakeDuration;
        minStakeDuration = newDuration;
        emit MinStakeDurationUpdated(oldDuration, newDuration);
    }

    /// @notice Set per-collection minimum staking duration (overrides global)
    /// @param collection The collection address
    /// @param duration The minimum stake duration in seconds
    function setCollectionMinStakeDuration(address collection, uint256 duration) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        collectionMinStakeDuration[collection] = duration;
        collectionMinStakeDurationSet[collection] = true;
        emit CollectionMinStakeDurationUpdated(collection, duration, true);
    }

    /// @notice Remove per-collection override, falling back to global duration
    /// @param collection The collection address
    function clearCollectionMinStakeDuration(address collection) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        delete collectionMinStakeDuration[collection];
        delete collectionMinStakeDurationSet[collection];
        emit CollectionMinStakeDurationUpdated(collection, 0, false);
    }

    // ------------------------------
    // Rescue
    // ------------------------------
    function rescueETH(uint256 amount) external onlyOwner {
        (bool ok,) = owner().call{value: amount}("");
        require(ok, "rescue fail");
    }

    function rescueERC20(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    function rescueERC721(address token, uint256 tokenId) external onlyOwner {
        require(staker[token][tokenId] == address(0), "Token is staked");
        IERC721(token).transferFrom(address(this), owner(), tokenId);
    }

    function rescueERC1155(address token, uint256 tokenId, uint256 amount) external onlyOwner {
        IERC1155(token).safeTransferFrom(address(this), owner(), tokenId, amount, "");
    }

    // ------------------------------
    // supportsInterface
    // ------------------------------
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155Receiver) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Allow contract to receive ETH
    receive() external payable {}
}
