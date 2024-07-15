// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Template is ERC20 {

    address public owner;

    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
        owner = msg.sender;
    }

    function adminMint(address to, uint256 amount) public {
        require(msg.sender == owner, "Only owner can mint");
        _mint(to, amount);
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint wad) public {
        require(address(this).balance >= wad, "Insufficient contract balance");
        (bool success,) = payable(msg.sender).call{value: wad}("");
        _burn(msg.sender, wad);
        require(success, "Transfer failed");
        emit Withdrawal(msg.sender, wad);
    }
}
