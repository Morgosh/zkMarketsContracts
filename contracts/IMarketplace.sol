// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMarketplace
/// @notice Interface defining marketplace order structures and functions
interface IMarketplace {
    enum ItemType {
        NFT,
        ERC20,
        ETH
    }

    enum BasicOrderType {
        ERC721_FOR_ETH,
        ERC20_FOR_ERC721,
        ERC20_FOR_ERC721_ANY
    }

    struct Item {
        ItemType itemType;
        address tokenAddress;
        uint256 identifier;
        uint256 amount;
    }

    struct OrderParameters {
        address payable offerer;
        BasicOrderType orderType;
        Item offer;
        Item consideration;
        address payable royaltyReceiver;
        uint256 royaltyPercentageIn10000;
        uint256 startTime;
        uint256 endTime;
        uint256 createdTime;
    }

    struct Order {
        OrderParameters parameters;
        bytes signature;
    }

    function createOrderHash(OrderParameters memory orderParameters) external view returns (bytes32);
}
