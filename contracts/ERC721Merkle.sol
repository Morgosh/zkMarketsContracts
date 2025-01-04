//SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ERC721Template.sol";

contract ERC721Merkle is ERC721Template {
    using SafeERC20 for IERC20;
    struct Tier {
        string title;
        bytes32 merkleRoot;
        uint256 price;
        uint256 erc20Price;
        uint128 maxMintAmount;
        uint128 saleStartTime;
        mapping(address => uint256) mints;
    }
    mapping(uint256 => Tier) public tiers;
    uint256[] public tierIds;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _contractURI,
        uint256 _maxSupply,
        uint256 _publicPrice,
        string memory _defaultBaseURI,
        string memory _notRevealedURI,
        address payable _withdrawalRecipientAddress,
        address payable _commissionRecipientAddress,
        uint256 _fixedCommisionThreshold,
        uint256 _commissionPercentageIn10000,
        address payable _defaultRoyaltyRecipient, // separate from withdrawal recipient to enhance security
        uint256 _defaultRoyaltyPercentageIn10000
    ) ERC721Template(
        _name,
        _symbol,
        _contractURI,
        _maxSupply,
        _publicPrice,
        _defaultBaseURI,
        _notRevealedURI,
        _withdrawalRecipientAddress,
        _commissionRecipientAddress,
        _fixedCommisionThreshold,
        _commissionPercentageIn10000,
        _defaultRoyaltyRecipient,
        _defaultRoyaltyPercentageIn10000
    ) {
        // add code here if you want to do something specific during contract deployment
    }

    /**
     * @notice Get how many more the user is eligible to mint
     * @param tierId Id of the tier minting from
     * @param user Address of the user
     * @param proof Merkle proof
     * @return Amount left to mint
     */
    function getMintEligibility(uint256 tierId, address user, bytes32[] calldata proof) external view returns (uint256) {
        //require(MerkleProof.verify(proof, tier.merkleRoot, keccak256(abi.encodePacked(msg.sender))), "Not in presale list for this tier");
        // return 0 if user is not in the merkleRoot
        if (!MerkleProof.verify(proof, tiers[tierId].merkleRoot, keccak256(abi.encodePacked(user)))) {
            return 0;
        }
        if (tiers[tierId].mints[user] >= tiers[tierId].maxMintAmount) {
            return 0;
        }
        return tiers[tierId].maxMintAmount - tiers[tierId].mints[user];
    }

    /**
     * @notice Get the mint's tier details
     * @param tierId Id of the tier to get the details for
     * @return merkleRoot Merkle root
     * @return price Price in ETH
     * @return maxMintAmount Max amount mintable
     * @return saleStartTime Mint's start timestamp
     * @return title Tier's title
     * @return ERC20Price Price in ERC20
     */
    function getTierDetails(uint256 tierId) external view returns (bytes32 merkleRoot, uint256 price, uint256 maxMintAmount, uint256 saleStartTime, string memory title, uint256 ERC20Price) {
        Tier storage tier = tiers[tierId];
        uint256 requiredERC20Tokens = 0;
        if (ethPriceFeedAddress != address(0) && ERC20PriceFeedAddress != address(0)) {
            requiredERC20Tokens = getRequiredERC20TokensChainlink(publicPrice);
        } else {
            requiredERC20Tokens = tier.erc20Price;
        }

        return (tier.merkleRoot, tier.price, tier.maxMintAmount, tier.saleStartTime, tier.title, requiredERC20Tokens);
    }

    /**
     * @notice Get all the tier ids
     */
    function getTierIds() external view returns (uint256[] memory) {
        return tierIds;
    }

    /**
     * @notice Mint tokens in a specific tier using ETH
     * @param tierId Id of the tier
     * @param amount Amount of tokens
     * @param proof Merkle proof
     */
    function whitelistMint(uint256 tierId, uint256 amount, bytes32[] calldata proof) external payable {
        Tier storage tier = tiers[tierId];
        checkWhitelistMintRequirements(amount, tier, proof);
        require(msg.value >= amount * tier.price, "Insufficient funds for mint");
        tier.mints[msg.sender] += amount;
        _safeMint(msg.sender, amount);
    }

    /**
     * @notice Mint tokens in a specific tier using ERC20 and Chainlink
     * @param tierId Id of the tier
     * @param amount Amount of tokens
     * @param proof Merkle proof
     */
    function whitelistMintWithERC20ChainlinkPrice(uint256 tierId, uint256 amount, bytes32[] calldata proof) external {
        Tier storage tier = tiers[tierId];
        checkWhitelistMintRequirements(amount, tier, proof);
        // Let's make sure price feed contract address exists
        require(ERC20TokenAddress != address(0), "Payment token address not set");

        // Calculate the cost in ERC20 tokens
        uint256 requiredTokenAmount = getRequiredERC20TokensChainlink(tier.price * amount);

        tier.mints[msg.sender] += amount;

        IERC20(ERC20TokenAddress).safeTransferFrom(msg.sender, address(this), requiredTokenAmount);

        _safeMint(msg.sender, amount);
    }

    /**
     * @notice Mint tokens in a specific tier using ERC20 and fixed price
     * @param tierId Id of the tier
     * @param amount Amount of tokens
     * @param proof Merkle proof
     */
    function whitelistMintWithFixedERC20Price(uint256 tierId, uint256 amount, bytes32[] calldata proof) external {
        Tier storage tier = tiers[tierId];
        checkWhitelistMintRequirements(amount, tier, proof);
        uint256 erc20Price = tier.erc20Price;
        require(ERC20TokenAddress != address(0), "Payment token address not set");
        require(erc20Price > 0, "Price per token not set");

        // Calculate the cost in ERC20 tokens
        uint256 requiredTokenAmount = erc20Price * amount;

        tier.mints[msg.sender] += amount;

        IERC20(ERC20TokenAddress).safeTransferFrom(msg.sender, address(this), requiredTokenAmount);

        _safeMint(msg.sender, amount);
    }

    /**
     * @notice Add or Set existing tier details
     * @param tierId Id of the tier
     * @param title Title
     * @param merkleRoot Merkle root
     * @param price Price in ETH
     * @param erc20Price Price in ERC20
     * @param maxMintAmount Max amount mintable
     * @param saleStartTime Mint's start timestamp
     */
    function setTier(uint256 tierId, string calldata title, bytes32 merkleRoot, uint256 price, uint256 erc20Price, uint256 maxMintAmount, uint256 saleStartTime) external onlyOwner {
        Tier storage tier = tiers[tierId];
        tier.merkleRoot = merkleRoot;
        tier.title = title;
        tier.price = price;
        tier.erc20Price = erc20Price;
        tier.maxMintAmount = uint128(maxMintAmount);
        tier.saleStartTime = uint128(saleStartTime); // type(uint256).max; is used to disable the tier
        // check if tierId is already in the array
        bool isNewTierId = true;
        for (uint256 i = 0; i < tierIds.length; i++) {
            if (tierIds[i] == tierId) {
                isNewTierId = false;
                break;
            }
        }
        if (isNewTierId) {
            tierIds.push(tierId);
        }
    }

    /**
     * @notice Enable a tier by setting its mint's start timestamp to 0
     * @param tierId Id of the tier
     */
    function enableTier(uint256 tierId) external onlyOwner {
        tiers[tierId].saleStartTime = 0;
    }

    /**
     * @notice Disable a tier by setting its mint's start timestamp to uint128.max
     * @param tierId Id of the tier
     */
    function disableTier(uint256 tierId) external onlyOwner {
        tiers[tierId].saleStartTime = type(uint128).max;
    }

    /**
     * @notice Set mint's start timestamp for a tier
     * @param tierId Id of the tier
     * @param saleStartTime Mint's start timestamp
     */
    function setTierSaleStartTime(uint256 tierId, uint256 saleStartTime) external onlyOwner {
        require(tiers[tierId].merkleRoot != bytes32(0), "Tier does not exist");
        tiers[tierId].saleStartTime = uint128(saleStartTime);
    }

    /**
     * @notice Set the prices for a tier
     * @param tierId Id of the tier
     * @param price Price in ETH
     * @param erc20Price Price in ERC20
     */
    function setTierPrice(uint256 tierId, uint256 price, uint256 erc20Price) external onlyOwner {
        require(tiers[tierId].merkleRoot != bytes32(0), "Tier does not exist");
        tiers[tierId].price = price;
        tiers[tierId].erc20Price = erc20Price;
    }

    /**
     * @notice Set tier's max mintable amount
     * @param tierId Id of the tier
     * @param maxMintAmount Max mintable amount
     */
    function setTierMaxMintAmount(uint256 tierId, uint256 maxMintAmount) external onlyOwner {
        require(tiers[tierId].merkleRoot != bytes32(0), "Tier does not exist");
        tiers[tierId].maxMintAmount = uint128(maxMintAmount);
    }

    /**
     * @notice Set the merkle root for a tier
     * @param tierId Id of the tier
     * @param merkleRoot Merkle root
     */
    function setTierMerkleRoot(uint256 tierId, bytes32 merkleRoot) external onlyOwner {
        require(tiers[tierId].merkleRoot != bytes32(0), "Tier does not exist");
        tiers[tierId].merkleRoot = merkleRoot;
    }

    /**
     * @notice Enforce tier's mint requirements
     * @param _mintAmount Amount of tokens to mint
     * @param tier Id of the tier
     * @param _proof Merkle proof
     */
    function checkWhitelistMintRequirements(uint256 _mintAmount, Tier storage tier, bytes32[] calldata _proof) internal view {
        bytes32 merkleRoot = tier.merkleRoot;
        require(merkleRoot != bytes32(0), "Tier does not exist");
        require(block.timestamp >= tier.saleStartTime, "Tier sale not started");
        require(MerkleProof.verify(_proof, merkleRoot, keccak256(abi.encodePacked(msg.sender))), "Not in presale list for this tier");
        require(_mintAmount <= tier.maxMintAmount - tier.mints[msg.sender], "Exceeds tier max mint amount");
        require(totalSupply() + _mintAmount <= maxSupply, "Exceeds max supply");
    }
}