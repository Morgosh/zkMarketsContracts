// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract ProphetsNFT is ERC721A, Ownable {
    using Strings for uint256;

    // States
    enum ProphetState { BULLISH, NEUTRAL, BEARISH, BONES_AND_ASHES }
    
    // Contract variables
    uint256 public constant MAX_SUPPLY = 666;
    uint256 public immutable MINT_PRICE;
    
    // Pyth price feed
    IPyth public pyth;
    bytes32 public ethUsdPriceId;
    
    // Pixel art images stored as base64
    string private bullishImage;
    string private neutralImage;
    string private bearishImage;
    string private bonesAndAshesImage;
    
    // Events
    // Note: No events needed - state is calculated dynamically
    
    constructor(
        string memory name,
        string memory symbol,
        address _pyth,
        bytes32 _ethUsdPriceId,
        uint256 _mintPrice
    ) ERC721A(name, symbol) Ownable(msg.sender) {
        pyth = IPyth(_pyth);
        ethUsdPriceId = _ethUsdPriceId;
        MINT_PRICE = _mintPrice;
        
        // Set placeholder images (to be updated by owner)
        bullishImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        neutralImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        bearishImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        bonesAndAshesImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    }
    
    // Minting function
    function mint(uint256 quantity) external payable {
        require(quantity > 0, "Must mint at least 1");
        require(quantity <= 10, "Max 10 per transaction");
        require(totalSupply() + quantity <= MAX_SUPPLY, "Exceeds max supply");
        require(msg.value >= MINT_PRICE * quantity, "Insufficient payment");
        
        _mint(msg.sender, quantity);
    }
    
    // Get current state based on ETH price levels
    function getCurrentState(bytes[] calldata priceUpdateData) external payable returns (ProphetState, int256) {
        // Update price feeds with provided data
        uint fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "Insufficient fee for price update");
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);
        
        // Get current price
        PythStructs.Price memory currentPriceData = pyth.getPriceUnsafe(ethUsdPriceId);
        int256 currentPrice = int256(currentPriceData.price);
        
        // Determine state based on price levels (prices are in 8 decimals)
        ProphetState state;
        if (currentPrice >= 350000000000) { // $3500+
            state = ProphetState.BULLISH;
        } else if (currentPrice <= 150000000000) { // $1500 or below
            state = ProphetState.BONES_AND_ASHES;
        } else if (currentPrice <= 200000000000) { // $1500-$2000
            state = ProphetState.BEARISH;
        } else {
            state = ProphetState.NEUTRAL; // $2000-$3500
        }
        
        return (state, currentPrice);
    }
    
    // Dynamic metadata generation
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        
        // Get current state using stored price (view function)
        ProphetState state = getCurrentStateView();
        
        // Get appropriate image and description
        string memory image;
        string memory description;
        string memory stateName;
        
        if (state == ProphetState.BULLISH) {
            image = bullishImage;
            description = "The prophets are BULLISH! ETH is above $3500. The market spirits are strong!";
            stateName = "BULLISH";
        } else if (state == ProphetState.NEUTRAL) {
            image = neutralImage;
            description = "The prophets remain NEUTRAL. ETH is between $2000-$3500. The spirits are balanced.";
            stateName = "NEUTRAL";
        } else if (state == ProphetState.BEARISH) {
            image = bearishImage;
            description = "The prophets are BEARISH. ETH is between $1500-$2000. The spirits are cautious.";
            stateName = "BEARISH";
        } else {
            image = bonesAndAshesImage;
            description = "BONES AND ASHES! ETH is below $1500. The spirits have fled!";
            stateName = "BONES_AND_ASHES";
        }
        
        // Create JSON metadata
        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name": "Prophet #',
                        tokenId.toString(),
                        '", "description": "',
                        description,
                        '", "image": "data:image/png;base64,',
                        image,
                        '", "attributes": [{"trait_type": "State", "value": "',
                        stateName,
                        '"}]}'
                    )
                )
            )
        );
        
        return string(abi.encodePacked("data:application/json;base64,", json));
    }
    
    // View function to get current state without updating prices
    function getCurrentStateView() public view returns (ProphetState) {
        try pyth.getPriceUnsafe(ethUsdPriceId) returns (PythStructs.Price memory currentPriceData) {
            int256 currentPrice = int256(currentPriceData.price);
            
            // Determine state based on price levels (prices are in 8 decimals)
            if (currentPrice >= 350000000000) { // $3500+
                return ProphetState.BULLISH;
            } else if (currentPrice <= 150000000000) { // $1500 or below
                return ProphetState.BONES_AND_ASHES;
            } else if (currentPrice <= 200000000000) { // $1500-$2000
                return ProphetState.BEARISH;
            } else {
                return ProphetState.NEUTRAL; // $2000-$3500
            }
        } catch {
            // Default to neutral if price can't be fetched
            return ProphetState.NEUTRAL;
        }
    }
    
    // Owner functions
    function updateImages(
        string memory _bullishImage,
        string memory _neutralImage,
        string memory _bearishImage,
        string memory _bonesAndAshesImage
    ) external onlyOwner {
        bullishImage = _bullishImage;
        neutralImage = _neutralImage;
        bearishImage = _bearishImage;
        bonesAndAshesImage = _bonesAndAshesImage;
    }
    
    function updatePythContract(address _pyth) external onlyOwner {
        pyth = IPyth(_pyth);
    }
    
    function updatePriceId(bytes32 _ethUsdPriceId) external onlyOwner {
        ethUsdPriceId = _ethUsdPriceId;
    }
    
    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "Withdrawal failed");
    }
} 