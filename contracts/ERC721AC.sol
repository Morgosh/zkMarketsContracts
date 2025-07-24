// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import "@limitbreak/creator-token-standards/src/erc721c/ERC721AC.sol";
import "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";


contract ERC721ACWithBasicRoyalties is OwnableBasic, ERC721AC, BasicRoyalties {
    
    string private _baseTokenURI;
    string private _contractURI;
    
    // Mapping for individual token URIs
    mapping(uint256 => string) private _tokenURIs;
    
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

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) public {
        _requireCallerIsContractOwner();
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) public {
        _requireCallerIsContractOwner();
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_exists(tokenId), "ERC721: URI query for nonexistent token");

        string memory _tokenURI = _tokenURIs[tokenId];
        
        // If there is a specific token URI, return it
        if (bytes(_tokenURI).length > 0) {
            return _tokenURI;
        }
        
        // Otherwise return base URI + tokenId
        return bytes(_baseTokenURI).length > 0 ? 
            string(abi.encodePacked(_baseTokenURI, _toString(tokenId))) : "";
    }
    
    function setTokenURI(uint256 tokenId, string memory _tokenURI) public {
        _requireCallerIsContractOwner();
        require(_exists(tokenId), "ERC721: URI set of nonexistent token");
        _tokenURIs[tokenId] = _tokenURI;
    }
    
    function setBaseURI(string memory baseTokenURI_) public {
        _requireCallerIsContractOwner();
        _baseTokenURI = baseTokenURI_;
    }
    
    function contractURI() public view returns (string memory) {
        return _contractURI;
    }
    
    function setContractURI(string memory contractURI_) public {
        _requireCallerIsContractOwner();
        _contractURI = contractURI_;
    }

    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external {
        _requireCallerIsContractOwner();
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Cannot mint to zero address");
            require(amounts[i] > 0, "Amount must be greater than 0");
            _mint(recipients[i], amounts[i]);
        }
    }
}
