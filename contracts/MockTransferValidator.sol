// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockTransferValidator
/// @notice Simple mock for testing ICreatorToken transfer validation
contract MockTransferValidator {
    bool public shouldBlock;

    function setBlockAll(bool _block) external {
        shouldBlock = _block;
    }

    function validateTransfer(address, address, address, uint256) external view {
        require(!shouldBlock, "Transfer blocked by validator");
    }
}
