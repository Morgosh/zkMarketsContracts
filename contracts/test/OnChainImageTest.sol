// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title On-Chain Image Storage Test
/// @notice Test contract to measure gas costs of storing images on-chain
contract OnChainImageTest is Ownable {
    
    // Store images as base64 data URIs
    mapping(string => string) public images;
    
    constructor() {}
    
    /// @notice Store an image on-chain
    /// @param key Image identifier (e.g., "prophesizing", "bullish", etc.)
    /// @param imageData Complete data URI (data:image/png;base64,...)
    function storeImage(string memory key, string memory imageData) external onlyOwner {
        images[key] = imageData;
    }
    
    /// @notice Get stored image
    /// @param key Image identifier
    /// @return Complete data URI
    function getImage(string memory key) external view returns (string memory) {
        return images[key];
    }
    
    /// @notice Get image size in bytes (for gas estimation)
    /// @param imageData Image data to measure
    /// @return Size in bytes
    function getImageSize(string memory imageData) external pure returns (uint256) {
        return bytes(imageData).length;
    }
}
