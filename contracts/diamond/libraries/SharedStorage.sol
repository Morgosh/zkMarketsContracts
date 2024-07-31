// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library SharedStorage {
    struct Storage {
        uint256 chainId;
        uint256 platformFee;
        string name;
        string version;
        bool paused;
        mapping (bytes32 => bool) ordersClaimed; // Tracks if a listing has been claimed
        mapping (address => uint256) ordersCanceledAt; // below the date all orders are canceled
        address premiumAddress;
        uint64 premiumDiscount;
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

    function setPlatformFee(uint256 _platformFee) internal {
        getStorage().platformFee = _platformFee;
    }

    function setPremiumDiscount(uint256 _premiumDiscount) internal {
        getStorage().premiumDiscount = uint64(_premiumDiscount);
    }
    
    function setPremiumAddress(address _premiumAddress) internal {
        getStorage().premiumAddress = _premiumAddress;
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
