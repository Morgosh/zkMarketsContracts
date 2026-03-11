// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

/// @title Staking Contract
/// @notice Allows users to stake ERC721 NFTs from whitelisted collections. Rewards handled off-chain via API.
contract Staking is Ownable, ERC721Holder {

    // State variables
    mapping(address => bool) public allowedCollections;
    mapping(address => mapping(uint256 => address)) public staker; // collection => tokenId => staker
    mapping(address => mapping(uint256 => uint256)) public stakedAt; // collection => tokenId => timestamp
    mapping(address => uint256) public stakedCount; // user => total staked count
    uint256 public minStakeDuration; // minimum seconds before unstaking is allowed

    // Events
    event Staked(address indexed user, address indexed collection, uint256 tokenId, uint256 timestamp);
    event Unstaked(address indexed user, address indexed collection, uint256 tokenId, uint256 timestamp);
    event CollectionUpdated(address indexed collection, bool allowed);
    event MinStakeDurationUpdated(uint256 oldDuration, uint256 newDuration);

    constructor() {}

    /// @notice Stake one or more NFTs from an allowed collection
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
            stakedCount[msg.sender] += 1;

            emit Staked(msg.sender, collection, tokenId, block.timestamp);
        }
    }

    /// @notice Unstake one or more NFTs
    /// @param collection The NFT collection address
    /// @param tokenIds Array of token IDs to unstake
    function unstake(address collection, uint256[] calldata tokenIds) external {
        require(tokenIds.length > 0, "No token IDs provided");

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(staker[collection][tokenId] == msg.sender, "Not staker");
            require(minStakeDuration == 0 || block.timestamp >= stakedAt[collection][tokenId] + minStakeDuration, "Min stake duration not met");

            delete staker[collection][tokenId];
            delete stakedAt[collection][tokenId];
            stakedCount[msg.sender] -= 1;

            IERC721(collection).transferFrom(address(this), msg.sender, tokenId);

            emit Unstaked(msg.sender, collection, tokenId, block.timestamp);
        }
    }

    // ------------------------------
    // Views
    // ------------------------------

    /// @notice Check if a specific token is currently staked
    /// @param collection The NFT collection address
    /// @param tokenId The token ID to check
    /// @return True if the token is staked
    function isStaked(address collection, uint256 tokenId) external view returns (bool) {
        return staker[collection][tokenId] != address(0);
    }

    /// @notice Get staking info for a token
    /// @param collection The NFT collection address
    /// @param tokenId The token ID
    /// @return stakerAddress The address that staked the token
    /// @return timestamp When the token was staked
    function getStakeInfo(address collection, uint256 tokenId) external view returns (address stakerAddress, uint256 timestamp) {
        return (staker[collection][tokenId], stakedAt[collection][tokenId]);
    }

    // ------------------------------
    // Admin
    // ------------------------------

    /// @notice Add or remove an allowed collection
    /// @param collection The NFT collection address
    /// @param allowed Whether the collection is allowed
    function setAllowedCollection(address collection, bool allowed) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        allowedCollections[collection] = allowed;
        emit CollectionUpdated(collection, allowed);
    }

    /// @notice Set minimum staking duration before unstaking is allowed
    /// @param newDuration Duration in seconds (0 = no minimum)
    function setMinStakeDuration(uint256 newDuration) external onlyOwner {
        uint256 oldDuration = minStakeDuration;
        minStakeDuration = newDuration;
        emit MinStakeDurationUpdated(oldDuration, newDuration);
    }

    // rescue
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

    /// @notice Allow contract to receive ETH
    receive() external payable {}
}
