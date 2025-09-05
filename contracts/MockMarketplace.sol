// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IMarketplace.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract MockMarketplace is IMarketplace, EIP712 {
    // EIP-712 type hashes
    bytes32 private constant _ORDER_PARAMETERS_TYPEHASH = keccak256(
        "OrderParameters(address offerer,uint8 orderType,Item offer,Item consideration,address royaltyReceiver,uint256 royaltyPercentageIn10000,uint256 startTime,uint256 endTime,uint256 createdTime)Item(uint8 itemType,address tokenAddress,uint256 identifier,uint256 amount)"
    );
    
    bytes32 private constant _ITEM_TYPEHASH = keccak256(
        "Item(uint8 itemType,address tokenAddress,uint256 identifier,uint256 amount)"
    );

    constructor() EIP712("MockMarketplace", "1") {}

    function createOrderHash(OrderParameters memory orderParameters) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            _ORDER_PARAMETERS_TYPEHASH,
            orderParameters.offerer,
            orderParameters.orderType,
            keccak256(abi.encode(
                _ITEM_TYPEHASH,
                orderParameters.offer.itemType,
                orderParameters.offer.tokenAddress,
                orderParameters.offer.identifier,
                orderParameters.offer.amount
            )),
            keccak256(abi.encode(
                _ITEM_TYPEHASH,
                orderParameters.consideration.itemType,
                orderParameters.consideration.tokenAddress,
                orderParameters.consideration.identifier,
                orderParameters.consideration.amount
            )),
            orderParameters.royaltyReceiver,
            orderParameters.royaltyPercentageIn10000,
            orderParameters.startTime,
            orderParameters.endTime,
            orderParameters.createdTime
        )));
    }

    // Helper function to get domain separator for testing
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
