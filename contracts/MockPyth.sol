// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";

// We extend the existing MockPyth to add our helper functions
contract MockPythExtended is MockPyth {
    
    constructor() MockPyth(60, 0) {
        // 60 seconds valid time period, 0 wei update fee
    }
    
    // Helper function to set price directly
    function setCurrentPrice(bytes32 id, int64 price) external {
        uint publishTime = block.timestamp;
        uint64 conf = uint64(int64(price) > 0 ? uint64(int64(price) / 100) : 0); // 1% confidence
        
        // Create price update data
        bytes[] memory updateData = new bytes[](1);
        updateData[0] = createPriceFeedUpdateData(
            id, 
            price, 
            conf, 
            -8, // expo (8 decimal places)
            int64(uint64(publishTime)),
            uint64(publishTime), // prevPublishTime
            uint64(int64(price)), // emaPrice (same as price)
            conf  // emaConf
        );
        
        // Update the price feed using external call
        this.updatePriceFeeds{value: 0}(updateData);
    }
    
    // Helper function to set price with custom timestamp
    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo, uint publishTime) external {
        // Create price update data
        bytes[] memory updateData = new bytes[](1);
        updateData[0] = createPriceFeedUpdateData(
            id, 
            price, 
            conf, 
            expo, 
            int64(price), // emaPrice (same as price)
            conf,  // emaConf
            uint64(publishTime), // publishTime
            uint64(publishTime)  // prevPublishTime
        );
        
        // Update the price feed using external call
        this.updatePriceFeeds{value: 0}(updateData);
    }
} 