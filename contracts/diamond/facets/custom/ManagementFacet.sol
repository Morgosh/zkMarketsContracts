// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {SharedStorage} from "../../libraries/SharedStorage.sol";
import {LibDiamond} from "../../libraries/LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ManagementFacet {
    using SafeERC20 for IERC20;

    event PlatformFeeUpdated(uint256 newPlatformFee);
    event PremiumDiscountUpdated(uint256 newPremiumDiscount);
    event PremiumAddressUpdated(address premiumAddress);
    event MarketplacePaused();
    event WethAddressUpdated();

    /**
     * @notice Set the platform fee
     * @param _platformFee Fee in BPS
     */
    function setPlatformFee(uint256 _platformFee) external {
        LibDiamond.enforceIsContractOwner();
        require(_platformFee <= 10000, "Fee exceeds maximum limit");
        SharedStorage.setPlatformFee(_platformFee);
        emit PlatformFeeUpdated(_platformFee);
    }

    /**
     * @notice Set the discount for premium NFT holders
     * @param _premiumDiscount Discount in BPS
     */
    function setPremiumDiscount(uint256 _premiumDiscount) external {
        LibDiamond.enforceIsContractOwner();
        require(_premiumDiscount <= 5000, "Discount exceeds maximum limit");
        SharedStorage.setPremiumDiscount(_premiumDiscount);
        emit PremiumDiscountUpdated(_premiumDiscount);
    }
    
    /**
     * @notice Set the Premium NFT address
     * @param _premiumAddress Address of the premium NFT
     */
    function setPremiumNftAddress(address _premiumAddress) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setPremiumNftAddress(_premiumAddress);
        emit PremiumAddressUpdated(_premiumAddress);
    }

    /**
     * @notice Set pause/unpause for the marketplace
     * @param _paused Boolean to pause/unpause the marketplace
     */
    function setMarketplacePaused(bool _paused) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setPaused(_paused);
        emit MarketplacePaused();
    }
    
    /**
     * @notice Set weth address
     * @param _weth address of the weth ERC20
     */
    function setWethAddress(address _weth) external {
        LibDiamond.enforceIsContractOwner();
        SharedStorage.setWETHAddress(_weth);
        emit WethAddressUpdated();
    }

    /**
     * @notice Platform fee getter
     * @return Platform fee in BPS
     */
    function getPlatformFee() external view returns (uint256) {
        return SharedStorage.getStorage().platformFee;
    }

    /**
     * @notice Premium discount getter
     * @return Discount in BPS
     */
    function getPremiumDiscount() external view returns (uint256) {
        return SharedStorage.getStorage().premiumDiscount;
    }
    
    /**
     * @notice Premium NFT address getter
     * @return Premium NFT address
     */
    function getPremiumNftAddress() external view returns (address) {
        return SharedStorage.getStorage().premiumNftAddress;
    }

    /**
     * @notice Marketplace pause getter
     * @return Boolean if paused or not
     */
    function getMarketplacePaused() external view returns (bool) {
        return SharedStorage.getStorage().paused;
    }
    
    /**
     * @notice Weth address getter
     * @return Address of the weth ERC20
     */
    function getWethAddress() external view returns (address) {
        return SharedStorage.getStorage().wethAddress;
    }

    /**
     * @notice Withdraw ETH available on the contract
     */
    function withdrawETH() external {
        LibDiamond.enforceIsContractOwner();
        payable(msg.sender).call{value: address(this).balance}("");
    }

    /**
     * @notice Withdraw ERC20 available on the contract
     * @param erc20Token Address of the ERC20 to withdraw
     */
    function withdrawERC20(IERC20 erc20Token) external {
        LibDiamond.enforceIsContractOwner();
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(msg.sender, erc20Balance);
    }

    // lets also make it a receiver
    receive() external payable {}
}
