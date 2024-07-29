// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {SharedStorage} from "../../libraries/SharedStorage.sol";
import {LibDiamond} from "../../libraries/LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ManagementFacet {
    using SafeERC20 for IERC20;

    event PlatformFeeUpdated(uint256 newPlatformFee);
    event PremiumDiscountUpdated(address premiumAddress, uint256 newPremiumDiscount);
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

    function setPremiumDiscount(address _premiumAddress, uint256 _premiumDiscount) external {
        LibDiamond.enforceIsContractOwner();
        require(_premiumDiscount <= 5000, "Discount exceeds maximum limit");
        SharedStorage.setPremiumDiscount(_premiumAddress, _premiumDiscount);
        emit PremiumDiscountUpdated(_premiumAddress, _premiumDiscount);
    }

    function getPremiumDiscount(address _premiumAddress) external view returns (uint256) {
        return SharedStorage.getStorage().premiumDiscounts[_premiumAddress];
    }

    function setWETHAddress(address _wethAddress) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setWETHAddress(_wethAddress);
        emit WETHAddressUpdated(_wethAddress);
    }

    function setMarketplacePaused(bool _paused) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setPaused(_paused);
        emit MarketplacePaused();
    }

    function getMarketplacePaused() external view returns (bool) {
        return SharedStorage.getStorage().paused;
    }

    function withdrawETH() external {
        LibDiamond.enforceIsContractOwner();
        payable(msg.sender).call{value: address(this).balance}("");
    }

    function withdrawERC20(IERC20 erc20Token) external {
        LibDiamond.enforceIsContractOwner();
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(msg.sender, erc20Balance);
    }

    // lets also make it a receiver
    receive() external payable {}
}
