// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

library Errors {
    error UnauthorizedMinter(address minter);
}

contract MockERC1155 is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    constructor() ERC1155("https://token-uri.com/{id}.json") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }
    
    function mint(address to, uint256 id, uint256 amount, bytes memory data) external {
        _mint(to, id, amount, data);
    }
    
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external {
        _mintBatch(to, ids, amounts, data);
    }

    /**
     * @notice Function to mint tokens directly, called only from authorized addresses
     * @param _to The receiver of the token
     * @param _tokenId The token id
     * @param _quantityBeingMinted Quantity to be minted
     */
    function authorizedMint(address _to, uint256 _tokenId, uint256 _quantityBeingMinted) external {
        if (!_canAuthorizedMint()) revert Errors.UnauthorizedMinter(msg.sender);
        _mint(_to, _tokenId, _quantityBeingMinted, "");
    }

    function _canAuthorizedMint() internal view returns (bool) {
        return hasRole(MINTER_ROLE, msg.sender);
    }

    function burn(address _owner, uint256 _tokenId, uint256 _amount) external {
        require(_owner == msg.sender || isApprovedForAll(_owner, msg.sender), "ERC1155: caller is not owner nor approved");
        _burn(_owner, _tokenId, _amount);
    }

    function burnBatch(address from, uint256[] memory ids, uint256[] memory amounts) external {
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "ERC1155: caller is not owner nor approved");
        _burnBatch(from, ids, amounts);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
