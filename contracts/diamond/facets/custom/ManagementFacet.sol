// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {SharedStorage} from "../../libraries/SharedStorage.sol";
import {LibDiamond} from "../../libraries/LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ManagementFacet {
    using SafeERC20 for IERC20;

    event PlatformFeeUpdated(uint256 newPlatformFee);
    event PremiumDiscountUpdated(uint256 newPremiumFee);
    event PremiumNFTAddressUpdated(address newPremiumNftAddress);
    event WETHAddressUpdated(address newWETHAddress);
    event MarketplacePaused();

    function setPlatformFee(uint256 _platformFee) external {
        LibDiamond.enforceIsContractOwner();
        require(_platformFee <= 10000, "Fee exceeds maximum limit");
        SharedStorage.setPlatformFee(_platformFee);
        emit PlatformFeeUpdated(_platformFee);
    }

    function getPlatformFee() external view returns (uint256) {
        return SharedStorage.getStorage().platformFee;
    }

    function setPremiumDiscount(uint256 _premiumDiscount) external {
        LibDiamond.enforceIsContractOwner();
        require(_premiumDiscount <= 5000, "Discount exceeds maximum limit");
        SharedStorage.setPremiumDiscount(_premiumDiscount);
        emit PremiumDiscountUpdated(_premiumDiscount);
    }

    function getPremiumDiscount() external view returns (uint256) {
        return SharedStorage.getStorage().premiumDiscount;
    }

    function setWETHAddress(address _wethAddress) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setWETHAddress(_wethAddress);
        emit WETHAddressUpdated(_wethAddress);
    }

    function setPremiumNftAddress(address _premiumNftAddress) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setPremiumNftAddress(_premiumNftAddress);
        emit PremiumNFTAddressUpdated(_premiumNftAddress);
    }

    function getPremiumNftAddress() external view returns (address) {
        return SharedStorage.getStorage().premiumNftAddress;
    }

    function setMarketplacePaused(bool _paused) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setPaused(_paused);
        emit MarketplacePaused();
    }

    function getMarketplacePaused() external returns (bool) {
        return SharedStorage.getStorage().paused;
    }

    function withdrawETH() external {
        LibDiamond.enforceIsContractOwner();
        payable(LibDiamond.diamondStorage().contractOwner).call{value: address(this).balance}("");
    }

    function withdrawERC20(IERC20 erc20Token) external {
        LibDiamond.enforceIsContractOwner();
        address owner = LibDiamond.diamondStorage().contractOwner;
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(owner, erc20Balance);
    }

    // lets also make it a receiver
    receive() external payable {}
}
