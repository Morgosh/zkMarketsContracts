// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TestUtils
/// @notice Utility contract for testing - provides reliable balance checking and other test helpers
contract TestUtils {
    
    /// @notice Get the balance of any address
    /// @param addr The address to check
    /// @return The balance in wei
    function getAddressBalance(address addr) external view returns (uint256) {
        return addr.balance;
    }
    
    /// @notice Get the balance of the TestUtils contract itself
    /// @return The contract's balance in wei
    function getThisContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /// @notice Get the balance of a specific contract address
    /// @param contractAddr The contract address to check
    /// @return The contract's balance in wei
    function getContractBalance(address contractAddr) external view returns (uint256) {
        return contractAddr.balance;
    }
    
    /// @notice Get current block timestamp
    /// @return Current block timestamp
    function getCurrentTime() external view returns (uint256) {
        return block.timestamp;
    }
    
    /// @notice Get current block number
    /// @return Current block number
    function getCurrentBlock() external view returns (uint256) {
        return block.number;
    }
    
    /// @notice Calculate days between two timestamps
    /// @param startTime The start timestamp
    /// @param endTime The end timestamp
    /// @return Number of complete days between the timestamps
    function daysBetween(uint256 startTime, uint256 endTime) external pure returns (uint256) {
        if (endTime <= startTime) return 0;
        return (endTime - startTime) / 1 days;
    }
    
    /// @notice Calculate weeks between two timestamps
    /// @param startTime The start timestamp
    /// @param endTime The end timestamp
    /// @return Number of complete weeks between the timestamps
    function weeksBetween(uint256 startTime, uint256 endTime) external pure returns (uint256) {
        if (endTime <= startTime) return 0;
        return (endTime - startTime) / 1 weeks;
    }
}
