//SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ScribesBase.sol";

contract ScribesMerkle is ScribesBase {
    uint256 public presalePrice;
    uint256 public presaleStartTime = 1698692400; // type(uint256).max;
    
    mapping(uint256 => bytes32) private presaleMerkleRoots;
    uint256[] private presaleTiers;

    mapping(uint256 => bytes32) private rewardMerkleRoots;
    uint256[] private rewardTiers;

    mapping(address => uint256) private presaleMints;
    mapping(address => uint256) private rewardMints;

    uint256 public presaleMintVestingTime = 1 days;
    uint256 public presaleMintVestingFixedDate = 1699383600;

    uint256 public rewardMintVestingTime = type(uint256).max;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _contractURI,
        uint256 _maxSupply,
        uint256 _publicPrice,
        string memory _defaultBaseURI,
        string memory _notRevealedURI,
        address payable _defaultRoyaltyRecipient,
        uint256 _defaultRoyaltyPercentageIn10000,
        uint256 _presalePrice
    ) ScribesBase(
        _name,
        _symbol,
        _contractURI,
        _maxSupply,
        _publicPrice,
        _defaultBaseURI,
        _notRevealedURI,
        _defaultRoyaltyRecipient,
        _defaultRoyaltyPercentageIn10000
    ) {
        // add code here if you want to do something specific during contract deployment
        presalePrice = _presalePrice;
    }


    // Get a root for a tier
    function getPresaleMerkleRoot(uint256 tier) public view returns (bytes32) {
        return presaleMerkleRoots[tier];
    }
    function getRewardMerkleRoot(uint256 tier) public view returns (bytes32) {
        return rewardMerkleRoots[tier];
    }

    function getValidPresaleTier(address _user, bytes32[] calldata _studentProof) public view returns (uint256) {
        uint256 highestValidTier = 0;
        for (uint256 i = 0; i < presaleTiers.length; i++) {
            bytes32 root = presaleMerkleRoots[presaleTiers[i]];
            if (MerkleProof.verify(_studentProof, root, keccak256(abi.encodePacked(_user)))) {
                // Check if the current valid tier is higher than the highestValidTier
                if (presaleTiers[i] > highestValidTier) {
                    highestValidTier = presaleTiers[i];
                }
            }
        }
        return highestValidTier - presaleMintedBy(_user);
    }
    function getValidRewardTier(address _user, bytes32[] calldata _studentProof) public view returns (uint256) {
        uint256 highestValidTier = 0;
        for (uint256 i = 0; i < rewardTiers.length; i++) {
            bytes32 root = rewardMerkleRoots[rewardTiers[i]];
            if (MerkleProof.verify(_studentProof, root, keccak256(abi.encodePacked(_user)))) {
                // Check if the current valid tier is higher than the highestValidTier
                if (rewardTiers[i] > highestValidTier) {
                    highestValidTier = rewardTiers[i];
                }
            }
        }
        return highestValidTier - rewardMintedBy(_user);
    }

    function presaleMintedBy(address account) public view returns (uint256) {
        return presaleMints[account];
    }
    function rewardMintedBy(address account) public view returns (uint256) {
        return rewardMints[account];
    }

    function presaleMint(
        uint256 k,
        bytes32[] calldata _studentProof
    ) external payable {
        require(block.timestamp >= presaleStartTime, "Presale not active");
        require(msg.value >= k * presalePrice, "Insufficient funds for mint");
        require(totalMintedPublic + k <= maxSupplyPublic, "Max supply reached");
        uint256 validTier = getValidPresaleTier(msg.sender, _studentProof);
        // error if the user is not in any tier or if the tier is smaller than the number of tokens user wants to mint
        require(validTier > 0 && validTier >= k, "Not prelisted");
        presaleMints[msg.sender] += k;
        for (uint256 i = 1; i <= k; i++) {
            _safeMint(msg.sender, startPublic + totalMintedPublic + i);
            // set vesting for 1 day
            if(presaleMintVestingFixedDate > 0) {
                _vestingDates[startPublic + totalMintedPublic + i] = presaleMintVestingFixedDate;
            } else {
                _vestingDates[startPublic + totalMintedPublic + i] = block.timestamp + presaleMintVestingTime; 
            }
        }
        totalMintedPublic += k;
    }

    function rewardMint(
        uint256 k,
        bytes32[] calldata _studentProof
    ) external payable {
        require(totalMintedReward + k <= startPublic, "Cannot mint more than max supply");
        uint256 validTier = getValidRewardTier(msg.sender, _studentProof);
        // error if the user is not in any tier or if the tier is smaller than the number of tokens user wants to mint
        require(validTier > 0 && validTier >= k, "Not prelisted");
        rewardMints[msg.sender] += k;
        for (uint256 i = 1; i <= k; i++) {
            _safeMint(msg.sender, totalMintedReward + i);
            _vestingDates[totalMintedReward + i] = rewardMintVestingTime;
        }
        totalMintedReward += k;
    }

    function setPresaleMerkleRoot(uint256 tier, bytes32 _presaleMerkleRoot) external onlyOwner {
        // If the tier has not been set yet, add it to the presaleTiers list
        if(presaleMerkleRoots[tier] == bytes32(0)) {
            presaleTiers.push(tier);
        }
        presaleMerkleRoots[tier] = _presaleMerkleRoot;
    }

    function setRewardMerkleRoot(uint256 tier, bytes32 _rewardMerkleRoot) external onlyOwner {
        // If the tier has not been set yet, add it to the rewardTiers list
        if(rewardMerkleRoots[tier] == bytes32(0)) {
            rewardTiers.push(tier);
        }
        rewardMerkleRoots[tier] = _rewardMerkleRoot;
    }

    function setPresalePrice(uint256 _newPrice) public onlyOwner {
        presalePrice = _newPrice;
    }

    function setPresaleMintVestingTime(uint256 _presaleMintVestingTime) public onlyOwner {
        presaleMintVestingTime = _presaleMintVestingTime;
    }

    function setRewardMintVestingTime(uint256 _rewardMintVestingTime) public onlyOwner {
        rewardMintVestingTime = _rewardMintVestingTime;
    }

    function togglePresaleActive() external onlyOwner {
        if (block.timestamp < presaleStartTime) {
            presaleStartTime = block.timestamp;
        } else {
            // This effectively disables the presale sale by setting the start time to a far future
            presaleStartTime = type(uint256).max;
        }
    }

    // Sets the start time of the public sale to a specific timestamp
    function setPresaleStartTime(uint256 _presaleStartTime) external onlyOwner {
        presaleStartTime = _presaleStartTime;
    }

    function setPresaleMintVestingFixedDate(uint256 _presaleMintVestingFixedDate) external onlyOwner {
        presaleMintVestingFixedDate = _presaleMintVestingFixedDate;
    }

}
