// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import "@limitbreak/creator-token-standards/src/erc721c/ERC721AC.sol";
import "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


contract MoodyMightsERC721AC is OwnableBasic, ERC721AC, BasicRoyalties {
    using SafeERC20 for IERC20;
    
    modifier onlyContractOwner() {
        _requireCallerIsContractOwner();
        _;
    }
    
    string private _baseTokenURI;
    string private _contractURI;
    
    constructor(
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        string memory name_,
        string memory symbol_,
        string memory baseTokenURI_)
        ERC721AC(name_, symbol_) 
        BasicRoyalties(royaltyReceiver_, royaltyFeeNumerator_) {
        _baseTokenURI = baseTokenURI_;
        _contractURI = ""; // Empty by default
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721AC, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) public onlyContractOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) public onlyContractOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_exists(tokenId), "ERC721: URI query for nonexistent token");
        
        return bytes(_baseTokenURI).length > 0 ? 
            string(abi.encodePacked(_baseTokenURI, _toString(tokenId))) : "";
    }
    
    function setBaseURI(string memory baseTokenURI_) public onlyContractOwner {
        _baseTokenURI = baseTokenURI_;
    }
    
    function contractURI() public view returns (string memory) {
        return _contractURI;
    }
    
    function setContractURI(string memory contractURI_) public onlyContractOwner {
        _contractURI = contractURI_;
    }

    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external onlyContractOwner {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Cannot mint to zero address");
            require(amounts[i] > 0, "Amount must be greater than 0");
            _mint(recipients[i], amounts[i]);
        }
    }
    
    function withdraw() external onlyContractOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "ETH withdrawal failed");
    }
    
    function withdrawERC20(address token) external onlyContractOwner {
        require(token != address(0), "Invalid token address");
        
        IERC20 erc20Token = IERC20(token);
        uint256 balance = erc20Token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        
        erc20Token.safeTransfer(owner(), balance);
    }
}
