// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import "@limitbreak/creator-token-standards/src/erc721c/ERC721AC.sol";
import "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


contract ERC721ACBasic is OwnableBasic, ERC721AC, BasicRoyalties {
    using SafeERC20 for IERC20;
    
    modifier onlyContractOwner() {
        _requireCallerIsContractOwner();
        _;
    }
    
    string private _baseTokenURI;
    string private _contractURI;
    address public approver;
    uint256 public maxSupply;
    
    // Hash => amount minted by user
    mapping(bytes32 => uint256) public mintedByHash;
    
    event MintWithSignature(address indexed to, uint256 amount, bytes32 indexed saleHash);
    event ApproverUpdated(address indexed oldApprover, address indexed newApprover);
    event MaxSupplyUpdated(uint256 oldMaxSupply, uint256 newMaxSupply);
    
    constructor(
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        string memory name_,
        string memory symbol_,
        string memory baseTokenURI_,
        address approver_,
        uint256 maxSupply_)
        ERC721AC(name_, symbol_) 
        BasicRoyalties(royaltyReceiver_, royaltyFeeNumerator_) {
        _baseTokenURI = baseTokenURI_;
        _contractURI = ""; // Empty by default
        approver = approver_;
        maxSupply = maxSupply_;
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

    function mint(
        uint256 saleId,
        uint256 endTime,
        uint256 maxMint,
        uint256 pricePerToken,
        uint256 amount,
        bytes calldata signature
    ) external payable {
        require(amount > 0, "Amount must be greater than 0");
        require(block.timestamp <= endTime, "Sale has ended");
        require(totalSupply() + amount <= maxSupply, "Exceeds max supply");
        require(msg.value == pricePerToken * amount, "Insufficient payment");
        
        bytes32 saleHash = keccak256(abi.encodePacked(msg.sender, saleId, endTime, maxMint, pricePerToken));
        require(_validateSignature(saleId, endTime, maxMint, pricePerToken, signature), "Invalid signature");
        require(mintedByHash[saleHash] + amount <= maxMint, "Exceeds max mint for this sale");
        
        mintedByHash[saleHash] += amount;
        _mint(msg.sender, amount);
        
        emit MintWithSignature(msg.sender, amount, saleHash);
    }
    
    function _validateSignature(
        uint256 saleId,
        uint256 endTime,
        uint256 maxMint,
        uint256 pricePerToken,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 message = keccak256(abi.encodePacked(msg.sender, saleId, endTime, maxMint, pricePerToken));
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(message);
        
        return SignatureChecker.isValidSignatureNow(approver, messageHash, signature);
    }
    
    function setApprover(address newApprover) external onlyContractOwner {
        require(newApprover != address(0), "Invalid approver address");
        
        address oldApprover = approver;
        approver = newApprover;
        
        emit ApproverUpdated(oldApprover, newApprover);
    }
    
    function setMaxSupply(uint256 newMaxSupply) external onlyContractOwner {
        require(newMaxSupply >= totalSupply(), "Max supply cannot be less than current supply");
        
        uint256 oldMaxSupply = maxSupply;
        maxSupply = newMaxSupply;
        
        emit MaxSupplyUpdated(oldMaxSupply, newMaxSupply);
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
    
    function getMintedAmount(
        address user,
        uint256 saleId,
        uint256 endTime,
        uint256 maxMint,
        uint256 pricePerToken
    ) external view returns (uint256) {
        bytes32 saleHash = keccak256(abi.encodePacked(user, saleId, endTime, maxMint, pricePerToken));
        return mintedByHash[saleHash];
    }
    
    function getRemainingMints(
        address user,
        uint256 saleId,
        uint256 endTime,
        uint256 maxMint,
        uint256 pricePerToken
    ) external view returns (uint256) {
        bytes32 saleHash = keccak256(abi.encodePacked(user, saleId, endTime, maxMint, pricePerToken));
        uint256 minted = mintedByHash[saleHash];
        return maxMint > minted ? maxMint - minted : 0;
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
}
