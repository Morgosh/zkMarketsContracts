// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library SharedStorage {
    struct Storage {
        uint256 chainId;
        address wethAddress;
        uint256 platformFee;
        string name;
        string version;
        bool paused;
        mapping (bytes32 => bool) ordersClaimed; // Tracks if a listing has been claimed
        mapping (address => uint256) ordersCanceledAt; // below the date all orders are canceled
        mapping (address => uint256) premiumDiscounts;
    }

    function getStorage() internal pure returns (Storage storage ds) {
        bytes32 position = keccak256("org.eip2535.diamond.storage");
        assembly {
            ds.slot := position
        }
    }

    function setChainId(uint256 _chainId) internal {
        getStorage().chainId = _chainId;
    }

    function setWETHAddress(address _wethAddress) internal {
        getStorage().wethAddress = _wethAddress;
    }

    function setPlatformFee(uint256 _platformFee) internal {
        getStorage().platformFee = _platformFee;
    }

    function setPremiumDiscount(address _premiumAddress, uint256 _premiumDiscount) internal {
        getStorage().premiumDiscounts[_premiumAddress] = _premiumDiscount;
    }

    function setName(string memory _name) internal {
        getStorage().name = _name;
    }

    function setVersion(string memory _version) internal {
        getStorage().version = _version;
    }

    function setPaused(bool _paused) internal {
        getStorage().paused = _paused;
    }

}
