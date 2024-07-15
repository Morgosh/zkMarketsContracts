// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./ERC721AStoreFront.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Storefront is ERC721AStoreFront, Ownable {
    uint256 public mintPrice;
    string public contractURI;

    constructor(string memory name, string memory symbol, uint256 _mintPrice, string memory _contractURI)
        ERC721AStoreFront(name, symbol)
        Ownable(msg.sender) // Set the deployer as the owner
    {
        mintPrice = _mintPrice;
        contractURI = _contractURI;
    }

    function mint(string memory cid) public payable {
        require(msg.value >= mintPrice, "Insufficient funds to mint.");
        _safeMint(msg.sender, cid, '');
    }

    function setMintPrice(uint256 _newMintPrice) public onlyOwner {
        mintPrice = _newMintPrice;
    }

    function setContractURI(string calldata _newContractURI) public onlyOwner {
        contractURI = _newContractURI;
    }

    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds available.");
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Transfer failed.");
    }

    // Override _startTokenId if you want your token IDs to start from 1 instead of 0
    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }
}