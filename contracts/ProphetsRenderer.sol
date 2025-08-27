// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title Prophets Renderer
/// @notice Generates metadata and images for Prophets of Ethereum NFTs based on state
/// @dev Images are stored permanently on-chain, write-once only
contract ProphetsRenderer is Ownable {
    using Strings for uint256;
    
    // On-chain image storage: state => data URI
    mapping(string => string) public images;
    
    event ImageStored(string indexed state, uint256 size);
    
    constructor() {}
    
    /// @notice Store an image on-chain for a specific state
    /// @param state The prophet state (prophesizing, bullish, bearish, burned)
    /// @param imageData Complete data URI (data:image/png;base64,...)
    function storeImage(string calldata state, string calldata imageData) external onlyOwner {
        require(bytes(imageData).length > 0, "empty-image");
        require(bytes(images[state]).length == 0, "already-stored");
        
        images[state] = imageData;
        emit ImageStored(state, bytes(imageData).length);
    }
    
    /// @notice Get image for a specific state
    /// @param state The prophet state (prophesizing, bullish, bearish, burned)
    /// @return Complete data URI for the image
    function getImage(string memory state) external view returns (string memory) {
        string memory imageData = images[state];
        require(bytes(imageData).length > 0, "image-not-found");
        return imageData;
    }
    
    /// @notice Get description based on Prophet state
    /// @param state The current state (prophesizing, bullish, bearish, burned)
    /// @return description string
    function getDescription(string memory state) public pure returns (string memory) {
        bytes32 stateHash = keccak256(abi.encodePacked(state));
        
        if (stateHash == keccak256(abi.encodePacked("burned"))) {
            return "A false prophet, consumed by divine flames for their hubris.";
        } else if (stateHash == keccak256(abi.encodePacked("bullish"))) {
            return "A bullish prophet, foreseeing ETH's ascension to greater heights.";
        } else if (stateHash == keccak256(abi.encodePacked("bearish"))) {
            return "A bearish prophet, warning of ETH's impending descent.";
        } else {
            return "A prophet in meditation, contemplating the ethereal mysteries of the market.";
        }
    }
}