// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Noot is ERC20 {
    address public owner;
    mapping(address => bool) public admins;
    mapping(address => bool) public hasClaimedFreeMint;
    
    uint256 public constant FREE_MINT_AMOUNT = 100000 * 10**18; // 100,000 tokens with 18 decimal places
    uint256 public constant PAID_MINT_FEE = 0.01 ether;

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
        owner = msg.sender;
        admins[msg.sender] = true;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier onlyAdmin() {
        require(admins[msg.sender], "Only admin can call this function");
        _;
    }

    function adminMint(address to, uint256 amount) public onlyAdmin {
        _mint(to, amount);
    }

    function freeMint() public {
        require(!hasClaimedFreeMint[msg.sender], "Already claimed free mint");
        hasClaimedFreeMint[msg.sender] = true;
        _mint(msg.sender, FREE_MINT_AMOUNT);
    }
    
    function paidMint() public payable {
        require(msg.value >= PAID_MINT_FEE, "Insufficient payment");
        _mint(msg.sender, FREE_MINT_AMOUNT);
    }
    
    function withdrawETH() public onlyOwner {
        (bool success,) = payable(owner).call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }
    
    function addAdmin(address _admin) external onlyOwner {
        require(!admins[_admin], "Address is already an admin");
        admins[_admin] = true;
    }
    
    function removeAdmin(address _admin) external onlyOwner {
        require(_admin != owner, "Owner cannot be removed from admins");
        require(admins[_admin], "Address is not an admin");
        admins[_admin] = false;
    }
}