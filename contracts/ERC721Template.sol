//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ERC721A.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract ERC721Template is IERC2981, Ownable, ERC721A  {
    using Strings for uint256;
    using SafeERC20 for ERC20;

    string private baseURI;
    string public notRevealedURI;
    uint256 public maxSupply;
    uint256 public publicPrice;
    uint256 public publicMaxMintAmount;
    uint256 public publicSaleStartTime = type(uint256).max;
    bool public isRevealed;

    address payable public immutable withdrawalRecipientAddress; // address that will receive revenue
    address payable public immutable commissionRecipientAddress;// address that will receive a part of revenue on withdrawal
    uint256 public immutable commissionPercentageIn10000; // percentage of revenue to be sent to commissionRecipientAddress
    uint256 private immutable fixedCommissionThreshold;
    uint256 private totalCommissionWithdrawn;
    uint256 private commissionToWithdraw;
    uint256 private ownerToWithdraw;

    uint256 immutable deployTimestamp = block.timestamp;

    string public contractURI;
    //presale price is set after

    // Default royalty info
    address payable public defaultRoyaltyRecipient;
    uint256 public defaultRoyaltyPercentageIn10000;

    // Add new state variables to handle ERC20 payments
    address public ERC20TokenAddress;
    uint256 public ERC20FixedPricePerToken; // Fixed price per token in ERC20
    uint256 public ERC20DiscountIn10000; // Discount percentage for ERC20 payments
    
    address public ERC20PriceFeedAddress;
    uint32 private ERC20PriceFeedStaleness;
    uint32 private ERC20PriceFeedDecimals;
    address public ethPriceFeedAddress;
    uint32 private ethPriceFeedStaleness;
    uint32 private ethPriceFeedDecimals;

    // Per-token royalty info
    mapping(uint256 => address payable) public tokenRoyaltyRecipient;
    mapping(uint256 => uint256) public tokenRoyaltyPercentage;

    event ContractURIUpdated();
    bool public tradingEnabled = true;
    mapping(address => bool) public blacklist;

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
        // set max mint amount after deployment
    ) ERC721A(_name, _symbol) Ownable(msg.sender) {
        maxSupply = _maxSupply;
        publicPrice = _publicPrice;
        contractURI = _contractURI; // no need to emit event here, as it's set in the constructor
        baseURI = _defaultBaseURI;
        notRevealedURI =_notRevealedURI;
        publicMaxMintAmount = 10000;
        withdrawalRecipientAddress = _withdrawalRecipientAddress;
        commissionRecipientAddress = _commissionRecipientAddress;
        fixedCommissionThreshold = _fixedCommisionThreshold;
        // Ensure commission percentage is between 0 and 10000 (0-100%)
        require(_commissionPercentageIn10000 <= 10000, "Invalid commission percentage");
        commissionPercentageIn10000 = _commissionPercentageIn10000;
        defaultRoyaltyRecipient = _defaultRoyaltyRecipient;
        defaultRoyaltyPercentageIn10000 = _defaultRoyaltyPercentageIn10000;
        isRevealed = bytes(_notRevealedURI).length == 0;
    }

    /**
     * @notice Implement EIP
     * @param interfaceId bytes to check if EIP compatible
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721A, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || 
            ERC721A.supportsInterface(interfaceId) || 
            super.supportsInterface(interfaceId);
    }

    /**
     * @notice implement ERC2981
     * @param _tokenId Id of the token
     * @param _salePrice Price of the token
     * @return recipient address
     * @return royalty amount
     */
    function royaltyInfo(uint256 _tokenId, uint256 _salePrice) external view override returns (address, uint256) {
        uint256 royaltyPercentage = tokenRoyaltyPercentage[_tokenId] != 0 ? tokenRoyaltyPercentage[_tokenId] : defaultRoyaltyPercentageIn10000;
        address royaltyRecipient = tokenRoyaltyRecipient[_tokenId] != address(0) ? tokenRoyaltyRecipient[_tokenId] : defaultRoyaltyRecipient;
        return (royaltyRecipient, (_salePrice * royaltyPercentage) / 10000);
    }
    
    /**
     * @notice Returns tokenURI, override to enable reveal/notRevealed
     * @param tokenId Id of the token to get URI for
     * @return URI
     */
    function tokenURI(
        uint256 tokenId
    ) public view virtual override returns (string memory) {
        require(
            ownerOf(tokenId) != address(0),
            "ERC721Metadata: URI query for nonexistent token"
        );
        if (isRevealed == false) {
            return notRevealedURI;
        }
        string memory identifier = tokenId.toString();
        return
            bytes(baseURI).length != 0
                ? string(abi.encodePacked(baseURI, identifier, ".json"))
                : "";
    }

    /**
     * @notice Get the amount of mint available for msg.sender
     * @return Amount of mint available
     */
    function getPublicMintEligibility() public view returns (uint256) {
        uint256 balance = balanceOf(msg.sender);
        uint256 maxMint = publicMaxMintAmount;
        if (balance >= maxMint) {
            return 0;
        }
        return maxMint - balance;
    }

    /**
     * @notice Get the mint details when minting with ETH
     * @return Mint's max supply
     * @return Mint's Public price
     * @return Current total supply
     * @return Mint's start timestamp
     */
    function getLaunchpadDetails() external view returns (uint256, uint256, uint256, uint256) {
        return (maxSupply, publicPrice, totalSupply(), publicSaleStartTime);
    }

    /**
     * @notice Get the mint details when minting with ERC20
     * @return Mint's ERC20 address
     * @return Mint's ERC20 price
     * @return Mint's ERC20 price if using Chainlink
     */
    function getLaunchpadDetailsERC20() external view returns (address, uint256, uint256) {
        uint256 requiredTokens = 0;
        if (ethPriceFeedAddress != address(0) && ERC20PriceFeedAddress != address(0)) {
            requiredTokens = getRequiredERC20TokensChainlink(publicPrice);
        }

        return (ERC20TokenAddress, ERC20FixedPricePerToken, requiredTokens);
    }

    /**
     * @notice Get the amount of ERC20 needed to mint at ETH price using Chainlink
     * @param ethPrice Total ETH needed for the mint
     * @return Amount of ERC20 needed
     */
    function getRequiredERC20TokensChainlink(uint256 ethPrice) public view returns (uint256) {
        address ethPriceFeed = ethPriceFeedAddress;
        address ERC20PriceFeed = ERC20PriceFeedAddress;
        require(ethPriceFeed != address(0) && ERC20PriceFeed != address(0), "Price feed addresses not set");

        // Get the latest prices from Chainlink
        uint256 ethPriceInUsd = getLatestPrice(ethPriceFeed, ethPriceFeedStaleness);
        uint256 ERC20PriceInUsd = getLatestPrice(ERC20PriceFeed, ERC20PriceFeedStaleness);

        // Prices from Chainlink are usually returned with 8 decimals
        uint256 ethPriceInUsdScaled = ethPriceInUsd * 10**(18 - ethPriceFeedDecimals); // Scale to 18 decimals
        uint256 ERC20PriceInUsdScaled = ERC20PriceInUsd * 10**(18 - ERC20PriceFeedDecimals); // Scale to 18 decimals

        // Calculate the equivalent cost in ERC20 tokens
        uint256 decimalsDiff = 10 ** (18 - ERC20(ERC20TokenAddress).decimals()); //most tokens don't go over 18 decimals
        uint256 totalERC20Cost = (ethPrice * ethPriceInUsdScaled) / ERC20PriceInUsdScaled / decimalsDiff;

        // Apply discount if set
        uint256 ERC20Discount = ERC20DiscountIn10000;
        if (ERC20Discount > 0) {
            totalERC20Cost = (totalERC20Cost * (10000 - ERC20Discount)) / 10000;
        }

        return totalERC20Cost;
    }

    /**
     * @notice Mint tokens with ETH for the msg.sender
     * @param _mintAmount Amount of token to mint
     */
    function mint(uint256 _mintAmount) external payable {
        checkMintRequirements(_mintAmount);
        require(msg.value >= publicPrice * _mintAmount, "Cost is higher than the amount sent");
        _safeMint(msg.sender, _mintAmount);
    }

    /**
     * @notice Mint tokens using ERC20 and Chainlink
     * @param _mintAmount Amount of tokens to mint
     */
    function mintWithERC20ChainlinkPrice(uint256 _mintAmount) external {
        checkMintRequirements(_mintAmount);
        // Let's make sure price feed contract address exists
        address ERC20Token = ERC20TokenAddress;
        require(ERC20Token != address(0), "Payment token address not set");

        // Calculate the cost in ERC20 tokens
        uint256 requiredTokenAmount = getRequiredERC20TokensChainlink(publicPrice * _mintAmount);

        ERC20(ERC20Token).safeTransferFrom(msg.sender, address(this), requiredTokenAmount);

        _safeMint(msg.sender, _mintAmount);
    }

    /**
     * @notice Mint tokens using ERC20 and a fixed price set by the owner
     * @param _mintAmount Amount of tokens to mint
     */
    function mintWithFixedERC20Price(uint256 _mintAmount) external {
        checkMintRequirements(_mintAmount);
        address ERC20Token = ERC20TokenAddress;
        uint256 ERC20FixedPrice = ERC20FixedPricePerToken;
        require(ERC20Token != address(0), "Payment token address not set");
        require(ERC20FixedPrice > 0, "Price per token not set");

        // Calculate the cost in ERC20 tokens
        uint256 requiredTokenAmount = ERC20FixedPrice * _mintAmount;

        ERC20(ERC20Token).safeTransferFrom(msg.sender, address(this), requiredTokenAmount);

        _safeMint(msg.sender, _mintAmount);
    }

    /**
     * @notice Mint tokens for free as admin to one address
     * @param _to Address receiving the tokens
     * @param _mintAmount Amount of tokens to mint
     */
    function adminMint(address _to, uint256 _mintAmount) public onlyOwner {
        require(totalSupply() + _mintAmount <= maxSupply, "Total supply exceeded");
        _safeMint(_to, _mintAmount);
    }

    /**
     * @notice Mint tokens for free as admin to multiple addresses
     * @param recipients Array of addressed receiving the tokens
     * @param amounts Array of amount of tokens to mint for each address
    */
    function batchAdminMint(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        for (uint256 i = 0; i < recipients.length; i++) {
            adminMint(recipients[i], amounts[i]);
        }
    }

    /**
     * @notice Set the public price in ETH
     * @param _newPrice Price in ETH
     */
    function setPublicPrice(uint256 _newPrice) external onlyOwner {
        publicPrice = _newPrice;
    }

    /**
     * @notice Set the base URI
     * @param _newBaseURI Base URI
     */
    function setBaseURI(string memory _newBaseURI) external onlyOwner {
        baseURI = _newBaseURI;
    }

    /**
     * @notice Set the not revealed URI
     * @param _notRevealedURI Not revealed URI
     */
    function setNotRevealedURI(string memory _notRevealedURI) external onlyOwner {
        notRevealedURI = _notRevealedURI;
    }

    /**
     * @notice Set the Max supply possible
     * @param _newMaxSupply Max supply amount
     */
    function setMaxSupply(uint256 _newMaxSupply) external onlyOwner {
        maxSupply = _newMaxSupply;
    }

    /**
     * @notice Sets the start time of the public sale to a specific timestamp
     * @param _publicSaleStartTime Start timestamp
     */
    function setPublicSaleStartTime(uint256 _publicSaleStartTime) external onlyOwner {
        publicSaleStartTime = _publicSaleStartTime;
    }

    /**
     * @notice Set the max amount mintable per address
     * @param _publicMaxMintAmount Amount mintable
     */
    function setPublicMaxMintAmount(uint256 _publicMaxMintAmount) external onlyOwner {
        publicMaxMintAmount = _publicMaxMintAmount;
    }

    /**
     * @notice Set the default royalty recipient and BPS
     * @param _defaultRoyaltyRecipient Address of the recipient
     * @param _defaultRoyaltyPercentageIn10000 Amount of royalty in BPS
     */
    function setDefaultRoyaltyInfo(address payable _defaultRoyaltyRecipient, uint256 _defaultRoyaltyPercentageIn10000) external onlyOwner {
        defaultRoyaltyRecipient = _defaultRoyaltyRecipient;
        defaultRoyaltyPercentageIn10000 = _defaultRoyaltyPercentageIn10000;
    }

    /**
     * @notice Set the royalty info for a specific id
     * @param _tokenId Id of the token
     * @param _royaltyRecipient  Address of the recipient
     * @param _royaltyPercentage Amount of royalty in BPS
     */
    function setTokenRoyaltyInfo(uint256 _tokenId, address payable _royaltyRecipient, uint256 _royaltyPercentage) external onlyOwner {
        require(ownerOf(_tokenId) != address(0), "Token does not exist");
        tokenRoyaltyRecipient[_tokenId] = _royaltyRecipient;
        tokenRoyaltyPercentage[_tokenId] = _royaltyPercentage;
    }
    
    /**
     * @notice Set the contract URI
     * @param newURI Contract URI
     */
    function setContractURI(string memory newURI) external onlyOwner {
        contractURI = newURI;
        emit ContractURIUpdated();
    }

    /**
     * @notice Set the ERC20 that can be used to mint
     * @param _ERC20TokenAddress Address of the ERC20
     */
    function setERC20TokenAddress(address _ERC20TokenAddress) external onlyOwner {
        ERC20TokenAddress = _ERC20TokenAddress;
    }

    /**
     * @notice Set the fixed price to mint with ERC20
     * @param _erc20FixedPricePerToken Price in ERC20
     */
    function setErc20FixedPricePerToken(uint256 _erc20FixedPricePerToken) external onlyOwner {
        ERC20FixedPricePerToken = _erc20FixedPricePerToken;
    }

    /**
     * @notice Set the ERC20 priceFeed details
     * @param _ERC20PriceFeedAddress Address of the pricefeed
     * @param _maxStaleness Max staleness
     */
    function setERC20PriceFeedAddress(address _ERC20PriceFeedAddress, uint256 _maxStaleness) external onlyOwner {
        ERC20PriceFeedAddress = _ERC20PriceFeedAddress;
        ERC20PriceFeedDecimals = uint32(AggregatorV3Interface(_ERC20PriceFeedAddress).decimals());
        ERC20PriceFeedStaleness = uint32(_maxStaleness);
    }

    /**
     * @notice Set the ERC20 priceFeed details
     * @param _ethPriceFeedAddress Address of the pricefeed
     * @param _maxStaleness Max staleness
     */
    function setETHPriceFeedAddress(address _ethPriceFeedAddress, uint256 _maxStaleness) external onlyOwner {
        ethPriceFeedAddress = _ethPriceFeedAddress;
        ethPriceFeedDecimals = uint32(AggregatorV3Interface(_ethPriceFeedAddress).decimals());
        ethPriceFeedStaleness = uint32(_maxStaleness);
    }

    /**
     * @notice Set the discount when minting with ERC20
     * @param _erc20DiscountIn10000 Discount in BPS
     */
    function setERC20DiscountIn10000(uint256 _erc20DiscountIn10000) external onlyOwner {
        require(_erc20DiscountIn10000 <= 10000, "Invalid discount percentage");
        ERC20DiscountIn10000 = _erc20DiscountIn10000;
    }

    /**
     * Set trading enabled for the token
     * @param _tradingEnabled Boolean to enable trading or not
     */
    function setTradingEnabled(bool _tradingEnabled) external onlyOwner {
        tradingEnabled = _tradingEnabled;
    }

    /**
     * @notice Add an address to the blacklist, not allowing them to transfer tokens anymore
     * @param _address Address to add to the blacklist
     */
    function addToBlacklist(address _address) external onlyOwner {
        blacklist[_address] = true;
    }

    /**
     * Remove an address from the blacklist
     * @param _address Address to remove from the blacklist
     */
    function removeFromBlacklist(address _address) external onlyOwner {
        blacklist[_address] = false;
    }

    /**
     * @notice Toggle the sale on or off by modifying the publicSaleStartTime variable
     */
    function togglePublicSaleActive() external onlyOwner {
        if (block.timestamp < publicSaleStartTime) {
            publicSaleStartTime = block.timestamp;
        } else {
            // This effectively disables the public sale by setting the start time to a far future
            publicSaleStartTime = type(uint256).max;
        }
    }

    /**
     * @notice Toggle reveal on or off
     */
    function toggleReveal() external onlyOwner {
        isRevealed = !isRevealed;
    }

    /**
     * @notice Withdraw the fixed commission for the commissionRecipientAddress
     */
    function withdrawFixedCommission() external {
        require(
            msg.sender == owner() || msg.sender == commissionRecipientAddress,
            "Only owner or commission recipient can withdraw"
        );
        uint256 withdrawn = totalCommissionWithdrawn;
        uint256 remainingCommission = fixedCommissionThreshold - withdrawn;
        uint256 amount = remainingCommission > address(this).balance 
                        ? address(this).balance 
                        : remainingCommission;

        // Updating the total withdrawn by A before making the transfer
        totalCommissionWithdrawn += amount;
        (bool success, ) = commissionRecipientAddress.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Withdraw ETH for the actor calling and saves the other actors due in storage to limit DOS from one actor
     */
    function withdraw() external virtual {
        require(
            msg.sender == owner() || msg.sender == commissionRecipientAddress  || msg.sender == withdrawalRecipientAddress,
            "Only owner or commission recipient can withdraw"
        );

        uint256 _commissionToWithdraw = commissionToWithdraw;
        uint256 _ownerToWithdraw = ownerToWithdraw;
        //This is ok if fixedCommissionThreshold makes it underflow, we don't allow eth withdraws until fixedCommissionThreshold can be paid fully
        uint256 available = address(this).balance - (fixedCommissionThreshold - totalCommissionWithdrawn) - _commissionToWithdraw - _ownerToWithdraw;

        uint256 newCommission = available * commissionPercentageIn10000 / 10000;
        uint256 newOwnerAmount = available - newCommission;

        if (msg.sender == commissionRecipientAddress) {
            ownerToWithdraw += newOwnerAmount;
            _commissionToWithdraw += newCommission;
            commissionToWithdraw = 0;
            (bool success, ) = commissionRecipientAddress.call{value: _commissionToWithdraw}("");
            require(success);
        } else if (msg.sender == withdrawalRecipientAddress || msg.sender == owner()) {
            commissionToWithdraw += newCommission;
            _ownerToWithdraw += newOwnerAmount;
            ownerToWithdraw = 0;
            (bool success, ) = withdrawalRecipientAddress.call{value: _ownerToWithdraw}("");
            require(success);
        }
    }

    /**
     * @notice Withdraw ERC20 for every actors
     * @param erc20Token Address of ther ERC20 to withdraw
     */
    function withdrawERC20(ERC20 erc20Token) external {
        require(
            msg.sender == owner() || msg.sender == commissionRecipientAddress  || msg.sender == withdrawalRecipientAddress,
            "Only owner or commission recipient can withdraw"
        );
        uint256 erc20Balance = erc20Token.balanceOf(address(this));
        uint256 commission = (erc20Balance * commissionPercentageIn10000) / 10000;
        uint256 withdrawalAddressAmount = erc20Balance - commission;

        //withdrawalRecipientAddress
        if(commission > 0) {
            erc20Token.safeTransfer(commissionRecipientAddress, commission);
        }

        if(withdrawalAddressAmount > 0) {
            erc20Token.safeTransfer(withdrawalRecipientAddress, withdrawalAddressAmount);
        }
    }

    /**
     * @notice Allows the owner to withdraw all ETH 28 weeks after deploy time
     */
    function emergencyWithdraw() external onlyOwner {
        require(block.timestamp > deployTimestamp + 28 weeks, "Too early to emergency withdraw");

        uint256 balance = address(this).balance;
        (bool success,) = payable(owner()).call{value: balance}("");
        require(success);
    }

    /**
     * @notice Allows the owner to withdraw all ERC20 28 weeks after deploy time
     */
    function emergencyWithdrawERC20(ERC20 erc20Token) external onlyOwner {
        require(block.timestamp > deployTimestamp + 28 weeks, "Too early to emergency withdraw");
        
        uint256 balance = erc20Token.balanceOf(address(this));
        erc20Token.safeTransfer(owner(), balance);
    }

    /**
     * @notice Get the price to mint with an ERC20 using Chainlink
     * @param priceFeedAddress Address of the pricefeed
     * @param maxStaleness Max staleness accepted for the pricefeed
     * @return Price received from Chainlink
     */
    function getLatestPrice(address priceFeedAddress, uint256 maxStaleness) internal view returns (uint256) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(priceFeedAddress);
        (, int256 price,,uint256 updatedAt,) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price from Chainlink");
        require(updatedAt > block.timestamp - maxStaleness, "Invalid price from Chainlink");
        return uint256(price);
    }

    /**
     * @notice Enforce mint requirements
     * @param _mintAmount Amount of token to mint
    */
    function checkMintRequirements(uint256 _mintAmount) internal view {
        require(totalSupply() + _mintAmount <= maxSupply, "Total supply exceeded");
        require(block.timestamp >= publicSaleStartTime, "Public sale not active");
        require(getPublicMintEligibility() >= _mintAmount, "Invalid amount to be minted");
    }

    /**
     * @notice Override to start from 1 instead of 0
     */
    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    /**
     * @notice Override to enable blacklist and pause
     */
    function _beforeTokenTransfers(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    )
        internal override
    {
        if (from != address(0)) {
            require(tradingEnabled, "Trading is disabled");
            require(!blacklist[msg.sender], "Blacklisted entities cannot execute trades");
        }
        super._beforeTokenTransfers(from, to, tokenId, batchSize);
    }
}