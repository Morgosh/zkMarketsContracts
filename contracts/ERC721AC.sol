// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import "@limitbreak/creator-token-standards/src/erc721c/ERC721AC.sol";
import "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";


contract ERC721ACWithBasicRoyalties is ERC721AC, BasicRoyalties {
    
    address private _owner;
    
    modifier onlyOwner() {
        require(msg.sender == _owner, "Not owner");
        _;
    }

    constructor(
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        string memory name_,
        string memory symbol_)
        ERC721AC(name_, symbol_) 
        BasicRoyalties(royaltyReceiver_, royaltyFeeNumerator_) {
        _owner = msg.sender;
    }
    
    function _requireCallerIsContractOwner() internal view override {
        require(msg.sender == _owner, "Not owner");
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721AC, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function safeMint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) public {
        _requireCallerIsContractOwner();
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) public {
        _requireCallerIsContractOwner();
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }
}
