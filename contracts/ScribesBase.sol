//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.11;

//import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

contract ScribesBase is ERC721Enumerable, IERC2981, Ownable {
    using Strings for uint256;

    string private baseURI;
    string public notRevealedURI;
    uint256 public maxSupplyPublic; // max supply is public supply so 1001-2000
    uint256 public publicPrice;
    uint256 public publicSaleStartTime = 1699383600;
    bool public isRevealed;
    // Add this to your variables declarations
    string public contractURI;
    //presale price is set after

    // Default royalty info
    address payable public defaultRoyaltyRecipient;
    uint256 public defaultRoyaltyPercentageIn10000;
    // Per-token royalty info
    mapping(uint256 => address payable) public tokenRoyaltyRecipient;
    mapping(uint256 => uint256) public tokenRoyaltyPercentage;

    uint256 public publicMintVestingTime = 0 days;

    // one variable for total minted counter
    uint256 public totalMintedReward = 0; // for reward mints we start 1-1000
    uint256 public totalMintedPublic = 0; // we start on 1001 because 1-1000 are reserved for rewards
    uint256 public startPublic = 1000;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _contractURI,
        uint256 _maxSupply,
        uint256 _publicPrice,
        string memory _defaultBaseURI,
        string memory _notRevealedURI,
        address payable _defaultRoyaltyRecipient,
        uint256 _defaultRoyaltyPercentageIn10000
    ) ERC721(_name, _symbol) {
        setMaxSupplyPublic(_maxSupply);
        setPublicPrice(_publicPrice);
        setContractURI(_contractURI);
        setBaseURI(_defaultBaseURI);
        setNotRevealedURI(_notRevealedURI);
        defaultRoyaltyRecipient = _defaultRoyaltyRecipient;
        defaultRoyaltyPercentageIn10000 = _defaultRoyaltyPercentageIn10000;
        isRevealed = keccak256(abi.encodePacked(_notRevealedURI)) == keccak256(abi.encodePacked("")) || 
            keccak256(abi.encodePacked(_notRevealedURI)) == keccak256(abi.encodePacked("null"));

        // lets admin mint to owner 1 nft
        adminMintVestedMaxEagleHat(msg.sender, 1);
    }

    function tokenURI(
        uint256 tokenId
    ) public view virtual override returns (string memory) {
        require(
            _exists(tokenId),
            "ERC721Metadata: URI query for nonexistent token"
        );
        string memory identifier;
        string memory uri;
        if (isRevealed == false) {
            uri = notRevealedURI;
            identifier = ((tokenId%4)+1).toString();
        } else {
            uri = baseURI;
            identifier = tokenId.toString();
        }
        return
            bytes(uri).length != 0
                ? string(abi.encodePacked(uri, identifier, ".json"))
                : "";
    }

    function maxSupply() public view returns (uint256) {
        return maxSupplyPublic;
    }

    // public
    function mint(uint256 _mintAmount) public payable {
        require(block.timestamp >= publicSaleStartTime, "Public sale not active");
        require(_mintAmount > 0, "You have to mint alteast one");
        require(totalMintedPublic + _mintAmount <= maxSupplyPublic, "Max supply reached");
        require(msg.value >= publicPrice * _mintAmount,"Cost is higher than the amount sent");
        for (uint256 i = 1; i <= _mintAmount; i++) {
            _safeMint(msg.sender, startPublic + totalMintedPublic + i);
            _vestingDates[startPublic + totalMintedPublic + i] = block.timestamp + publicMintVestingTime; 
        }
        totalMintedPublic += _mintAmount;
    }

    function setPublicPrice(uint256 _newPrice) public onlyOwner {
        publicPrice = _newPrice;
    }

    function setBaseURI(string memory _baseURI) public onlyOwner {
        baseURI = _baseURI;
    }

    function setNotRevealedURI(string memory _notRevealedURI) public onlyOwner {
        notRevealedURI = _notRevealedURI;
    }

    function setMaxSupplyPublic(uint256 _newmaxSupply) public onlyOwner {
        maxSupplyPublic = _newmaxSupply;
    }

    function setContractURI(string memory _contractURI) public onlyOwner {
        contractURI = _contractURI;
    }

    function togglePublicSaleActive() external onlyOwner {
        if (block.timestamp < publicSaleStartTime) {
            publicSaleStartTime = block.timestamp;
        } else {
            // This effectively disables the public sale by setting the start time to a far future
            publicSaleStartTime = type(uint256).max;
        }
    }

    // Sets the start time of the public sale to a specific timestamp
    function setPublicSaleStartTime(uint256 _publicSaleStartTime) external onlyOwner {
        publicSaleStartTime = _publicSaleStartTime;
    }

    function toggleReveal() external onlyOwner {
        isRevealed = !isRevealed;
    }

    function setDefaultRoyaltyInfo(address payable _defaultRoyaltyRecipient, uint256 _defaultRoyaltyPercentageIn10000) public onlyOwner {
        defaultRoyaltyRecipient = _defaultRoyaltyRecipient;
        defaultRoyaltyPercentageIn10000 = _defaultRoyaltyPercentageIn10000;
    }

    function setTokenRoyaltyInfo(uint256 _tokenId, address payable _royaltyRecipient, uint256 _royaltyPercentage) public onlyOwner {
        require(_exists(_tokenId), "Token does not exist");
        tokenRoyaltyRecipient[_tokenId] = _royaltyRecipient;
        tokenRoyaltyPercentage[_tokenId] = _royaltyPercentage;
    }

    // implement ERC2981
    function royaltyInfo(uint256 _tokenId, uint256 _salePrice) external view override returns (address, uint256) {
        uint256 royaltyPercentage = tokenRoyaltyPercentage[_tokenId] != 0 ? tokenRoyaltyPercentage[_tokenId] : defaultRoyaltyPercentageIn10000;
        address royaltyRecipient = tokenRoyaltyRecipient[_tokenId] != address(0) ? tokenRoyaltyRecipient[_tokenId] : defaultRoyaltyRecipient;
        return (royaltyRecipient, (_salePrice * royaltyPercentage) / 10000);
    }

        // Mapping from token ID to vesting date
    mapping(uint256 => uint256) public _vestingDates;

    function getVestingDate(uint256 tokenId) public view returns (uint256) {
        return _vestingDates[tokenId];
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    )
        internal override
    {
        if (from != address(0)) {
            //holder vesting free mints / allowlist
            require(
                block.timestamp >= _vestingDates[tokenId],
                "This token is vested"
            );
        }
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function setVestingDate(uint256 tokenId, uint256 vestingDate)
        external
        onlyOwner
    {
        _vestingDates[tokenId] = vestingDate;
    }

    function setPublicMintVestingTime(uint256 _publicMintVestingTime)
        external
        onlyOwner
    {
        publicMintVestingTime = _publicMintVestingTime;
    }

    function adminMintVestedMaxEagleHat(address _to, uint256 _mintAmount) public onlyOwner {
        for (uint256 i = 1; i <= _mintAmount; i++) {
            _safeMint(_to, totalMintedReward + i);
            _vestingDates[totalMintedReward + i] = type(uint256).max;
        }
        totalMintedReward += _mintAmount;
    }

    function adminMintVestedMax(address _to, uint256 _mintAmount) public onlyOwner {
        for (uint256 i = 1; i <= _mintAmount; i++) {
            _safeMint(_to, startPublic + totalMintedPublic + i);
            _vestingDates[startPublic + totalMintedPublic + i] = type(uint256).max;
        }
        totalMintedPublic += _mintAmount;
    }

    function adminMintCustomVested(address _to, uint256 _mintAmount, uint256 _vestedDate) public onlyOwner {
        for (uint256 i = 1; i <= _mintAmount; i++) {
            _safeMint(_to, startPublic + totalMintedPublic + i);
            _vestingDates[startPublic + totalMintedPublic + i] = _vestedDate;
        }
        totalMintedPublic += _mintAmount;
    }

    function adminMint(address _to, uint256 _mintAmount) public onlyOwner {
        for (uint256 i = 1; i <= _mintAmount; i++) {
            _safeMint(_to, startPublic + totalMintedPublic + i);
        }
        totalMintedPublic += _mintAmount;
    }

    function withdraw() public onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "Transfer failed.");
    }
}
