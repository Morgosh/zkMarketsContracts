// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Simple mock to stand in for Pyth in tests
contract MockPyth {
    int64 public price; // normalized to 1e8
    int32 public expo;  // typically -8

    constructor(int64 initialPrice, int32 initialExpo) {
        price = initialPrice;
        expo = initialExpo;
    }

    function setPrice(int64 p, int32 e) external {
        price = p;
        expo = e;
    }

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) { return 0; }
    function updatePriceFeeds(bytes[] calldata) external payable {}

    // Match tuple shape used by the main contract via IPyth.getPriceNoOlderThan
    function getPriceNoOlderThan(bytes32, uint256)
        external
        view
        returns (int64, uint64, int32, uint256)
    {
        return (price, 0, expo, block.timestamp);
    }
}