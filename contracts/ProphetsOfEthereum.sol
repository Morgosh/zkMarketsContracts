// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * @title Prophets of Ethereum
 * @notice A dynamic NFT collection where prophets predict ETH price movements
 * @dev Each NFT changes state based on predictions and market performance
 */
contract ProphetsOfEthereum is ERC721A, Ownable, IERC2981 {
    using Strings for uint256;

    // ═══════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════
    
    uint256 public constant TOTAL_SUPPLY = 666;
    uint256 public constant MINT_PRICE = 0.01 ether;
    uint256 public constant MAINTENANCE_FEE = 1 ether;
    uint256 public constant JUDGMENT_THRESHOLD = 1000; // 10% = 1000 basis points
    uint256 public constant LISTING_GRACE_PERIOD = 1 hours;
    
    // Royalty info
    address public constant ROYALTY_RECEIVER = 0x8F995E8961D2FF09d444aB4eC72d67f36aa2c8CC;
    uint96 public constant ROYALTY_FEE = 500; // 5%

    // ═══════════════════════════════════════════════════════════════════
    //                               ENUMS
    // ═══════════════════════════════════════════════════════════════════
    
    enum ProphetState {
        PROPHESIZING,  // 0 - Default meditation state (Sundays)
        BULLISH,       // 1 - Predicting ETH rise
        BEARISH,       // 2 - Predicting ETH fall  
        BURNED         // 3 - Failed prophet (permanent)
    }

    // ═══════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════
    
    struct Prophet {
        ProphetState state;
        uint256 lastPredictionWeek;
        uint256 predictedPrice;
        uint256 listingTime;
        uint256 listingPrice;
    }

    struct WeeklyRitual {
        uint256 startPrice;      // ETH price at ritual start
        uint256 endPrice;        // ETH price at ritual end
        uint256 startTimestamp;  // When ritual started
        bool isActive;           // Is ritual currently active
        bool judged;             // Has judgment been executed
    }

    // ═══════════════════════════════════════════════════════════════════
    //                            STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════
    
    mapping(uint256 => Prophet) public prophets;
    mapping(uint256 => WeeklyRitual) public weeklyRituals;
    
    uint256 public currentWeek;
    uint256 public aliveProphets;
    uint256 public divineTreasury;
    bool public mintingActive;
    string private _baseTokenURI;
    
    // Price oracle (simplified - in production use Chainlink)
    address public priceOracle;
    uint256 public lastKnownETHPrice;

    // ═══════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════
    
    event RitualStarted(uint256 indexed week, uint256 ethPrice);
    event ProphecyMade(uint256 indexed tokenId, ProphetState prediction, uint256 predictedPrice);
    event JudgmentExecuted(uint256 indexed week, uint256 burnedCount);
    event ProphetBurned(uint256 indexed tokenId, string reason);
    event DivineVictory(uint256 indexed tokenId, uint256 treasuryAmount);
    event ListingPunishment(uint256 indexed tokenId, uint256 listingPrice, uint256 minFloorPrice);

    // ═══════════════════════════════════════════════════════════════════
    //                              MODIFIERS
    // ═══════════════════════════════════════════════════════════════════
    
    modifier onlyProphetOwner(uint256 tokenId) {
        require(ownerOf(tokenId) == msg.sender, "Not prophet owner");
        _;
    }
    
    modifier prophetAlive(uint256 tokenId) {
        require(prophets[tokenId].state != ProphetState.BURNED, "Prophet is burned");
        _;
    }
    
    modifier duringMeditation() {
        require(isSunday() && !weeklyRituals[currentWeek].isActive, "Not meditation time");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                             CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════
    
    constructor(
        string memory baseTokenURI,
        address _priceOracle
    ) ERC721A("Prophets of Ethereum", "PROPHET") {
        _baseTokenURI = baseTokenURI;
        priceOracle = _priceOracle;
        aliveProphets = 0;
        currentWeek = 1;
        lastKnownETHPrice = 3000 ether; // Starting price assumption
    }

    // ═══════════════════════════════════════════════════════════════════
    //                            MINTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function startMinting() external onlyOwner {
        mintingActive = true;
    }
    
    function mint(uint256 quantity) external payable {
        require(mintingActive, "Minting not active");
        require(quantity > 0 && quantity <= 10, "Invalid quantity");
        require(totalSupply() + quantity <= TOTAL_SUPPLY, "Exceeds max supply");
        require(msg.value >= MINT_PRICE * quantity, "Insufficient payment");
        
        uint256 startTokenId = _nextTokenId();
        _mint(msg.sender, quantity);
        
        // Initialize prophets in meditation state
        for (uint256 i = 0; i < quantity; i++) {
            prophets[startTokenId + i] = Prophet({
                state: ProphetState.PROPHESIZING,
                lastPredictionWeek: 0,
                predictedPrice: 0,
                listingTime: 0,
                listingPrice: 0
            });
        }
        
        aliveProphets += quantity;
        
        // Add to divine treasury (minus maintenance fee)
        uint256 treasuryAmount = msg.value;
        if (divineTreasury == 0 && treasuryAmount >= MAINTENANCE_FEE) {
            treasuryAmount -= MAINTENANCE_FEE;
        }
        divineTreasury += treasuryAmount;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                           PROPHECY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function makeProphecy(
        uint256 tokenId, 
        ProphetState prediction, 
        uint256 predictedPrice
    ) external onlyProphetOwner(tokenId) prophetAlive(tokenId) duringMeditation {
        require(prediction == ProphetState.BULLISH || prediction == ProphetState.BEARISH, "Invalid prediction");
        require(predictedPrice > 0, "Invalid price prediction");
        require(prophets[tokenId].lastPredictionWeek < currentWeek, "Already predicted this week");
        
        prophets[tokenId].state = prediction;
        prophets[tokenId].predictedPrice = predictedPrice;
        prophets[tokenId].lastPredictionWeek = currentWeek;
        
        emit ProphecyMade(tokenId, prediction, predictedPrice);
    }
    
    function startWeeklyRitual() external {
        require(isSunday(), "Ritual only starts on Sunday");
        require(!weeklyRituals[currentWeek].isActive, "Ritual already active");
        
        uint256 currentPrice = getCurrentETHPrice();
        weeklyRituals[currentWeek] = WeeklyRitual({
            startPrice: currentPrice,
            endPrice: 0,
            startTimestamp: block.timestamp,
            isActive: true,
            judged: false
        });
        
        emit RitualStarted(currentWeek, currentPrice);
    }
    
    function executeJudgment() external {
        require(isSunday(), "Judgment only on Sunday");
        require(weeklyRituals[currentWeek].isActive, "No active ritual");
        require(!weeklyRituals[currentWeek].judged, "Already judged");
        require(block.timestamp >= weeklyRituals[currentWeek].startTimestamp + 7 days, "Too early for judgment");
        
        uint256 endPrice = getCurrentETHPrice();
        weeklyRituals[currentWeek].endPrice = endPrice;
        weeklyRituals[currentWeek].judged = true;
        weeklyRituals[currentWeek].isActive = false;
        
        uint256 burnedCount = _executeDivineJudgment(currentWeek);
        
        emit JudgmentExecuted(currentWeek, burnedCount);
        
        // Check for divine victory
        if (aliveProphets == 1) {
            _executeDivineVictory();
        } else if (aliveProphets == 0) {
            _executeLastStandJudgment();
        }
        
        // Reset prophets to meditation for next week
        _resetToMeditation();
        currentWeek++;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          JUDGMENT LOGIC
    // ═══════════════════════════════════════════════════════════════════
    
    function _executeDivineJudgment(uint256 week) private returns (uint256 burnedCount) {
        WeeklyRitual memory ritual = weeklyRituals[week];
        uint256 priceChange = _calculatePriceChange(ritual.startPrice, ritual.endPrice);
        bool ethWentUp = ritual.endPrice > ritual.startPrice;
        
        for (uint256 tokenId = _startTokenId(); tokenId < _nextTokenId(); tokenId++) {
            if (prophets[tokenId].state == ProphetState.BURNED) continue;
            
            Prophet storage prophet = prophets[tokenId];
            
            // Skip if prophet didn't make a prediction
            if (prophet.lastPredictionWeek < week) {
                _burnProphet(tokenId, "Failed to prophesy");
                burnedCount++;
                continue;
            }
            
            bool correctDirection = (ethWentUp && prophet.state == ProphetState.BULLISH) ||
                                  (!ethWentUp && prophet.state == ProphetState.BEARISH);
            
            // Check if prediction was accurate enough
            if (!correctDirection || priceChange > JUDGMENT_THRESHOLD) {
                _burnProphet(tokenId, "False prophecy");
                burnedCount++;
            }
        }
    }
    
    function _executeLastStandJudgment() private {
        // Find the prophet with the closest prediction
        uint256 bestTokenId;
        uint256 smallestError = type(uint256).max;
        
        for (uint256 tokenId = _startTokenId(); tokenId < _nextTokenId(); tokenId++) {
            if (prophets[tokenId].state != ProphetState.BURNED) continue;
            
            uint256 error = _abs(int256(prophets[tokenId].predictedPrice) - int256(weeklyRituals[currentWeek].endPrice));
            if (error < smallestError) {
                smallestError = error;
                bestTokenId = tokenId;
            }
        }
        
        if (bestTokenId != 0) {
            // Resurrect the closest prophet and grant victory
            prophets[bestTokenId].state = ProphetState.BULLISH;
            aliveProphets = 1;
            _executeDivineVictory();
        }
    }
    
    function _executeDivineVictory() private {
        // Find the last living prophet
        for (uint256 tokenId = _startTokenId(); tokenId < _nextTokenId(); tokenId++) {
            if (prophets[tokenId].state != ProphetState.BURNED) {
                prophets[tokenId].state = ProphetState.BULLISH; // Forever bullish
                
                // Transfer divine treasury to the prophet owner
                address winner = ownerOf(tokenId);
                payable(winner).transfer(divineTreasury);
                
                emit DivineVictory(tokenId, divineTreasury);
                divineTreasury = 0;
                break;
            }
        }
    }
    
    function _burnProphet(uint256 tokenId, string memory reason) private {
        prophets[tokenId].state = ProphetState.BURNED;
        aliveProphets--;
        emit ProphetBurned(tokenId, reason);
    }
    
    function _resetToMeditation() private {
        for (uint256 tokenId = _startTokenId(); tokenId < _nextTokenId(); tokenId++) {
            if (prophets[tokenId].state != ProphetState.BURNED) {
                prophets[tokenId].state = ProphetState.PROPHESIZING;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        MARKETPLACE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function onList(uint256 tokenId, uint256 price) external {
        require(msg.sender == ownerOf(tokenId), "Not token owner");
        
        prophets[tokenId].listingTime = block.timestamp;
        prophets[tokenId].listingPrice = price;
        
        // Check if listing is below minimal floor price
        uint256 minFloorPrice = getMinimalFloorPrice();
        if (price < minFloorPrice) {
            _burnProphet(tokenId, "Listed below minimal floor price");
            emit ListingPunishment(tokenId, price, minFloorPrice);
        }
    }
    
    function checkListingBurn(uint256 tokenId) external {
        Prophet storage prophet = prophets[tokenId];
        
        // Only burn if within grace period and below floor
        if (prophet.listingTime > 0 && 
            block.timestamp <= prophet.listingTime + LISTING_GRACE_PERIOD &&
            prophet.listingPrice < getMinimalFloorPrice() &&
            prophet.state != ProphetState.BURNED) {
            
            _burnProphet(tokenId, "Listed below minimal floor price");
            emit ListingPunishment(tokenId, prophet.listingPrice, getMinimalFloorPrice());
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //                           VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function getMinimalFloorPrice() public view returns (uint256) {
        if (aliveProphets == 0) return 0;
        return divineTreasury / aliveProphets;
    }
    
    function isSunday() public view returns (bool) {
        return (block.timestamp / 86400 + 4) % 7 == 0; // Sunday = 0
    }
    
    function getCurrentETHPrice() public view returns (uint256) {
        // Simplified - in production, use Chainlink oracle
        if (priceOracle != address(0)) {
            // Call oracle contract
            (bool success, bytes memory data) = priceOracle.staticcall(
                abi.encodeWithSignature("latestAnswer()")
            );
            if (success && data.length > 0) {
                return abi.decode(data, (uint256));
            }
        }
        return lastKnownETHPrice;
    }
    
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_exists(tokenId), "URI query for nonexistent token");
        
        Prophet memory prophet = prophets[tokenId];
        
        // Generate on-chain metadata
        string memory stateStr = _getStateString(prophet.state);
        string memory attributes = string(abi.encodePacked(
            '{"trait_type": "State", "value": "', stateStr, '"},'
            '{"trait_type": "Week", "value": "', prophet.lastPredictionWeek.toString(), '"},'
            '{"trait_type": "Alive Prophets", "value": "', aliveProphets.toString(), '"}'
        ));
        
        string memory json = string(abi.encodePacked(
            '{"name": "Prophet #', tokenId.toString(), '",',
            '"description": "A prophet of Ethereum, bound by divine judgment.",',
            '"image": "', _baseTokenURI, stateStr, '.png",',
            '"attributes": [', attributes, ']}'
        ));
        
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function _getStateString(ProphetState state) private pure returns (string memory) {
        if (state == ProphetState.PROPHESIZING) return "prophesizing";
        if (state == ProphetState.BULLISH) return "bullish";
        if (state == ProphetState.BEARISH) return "bearish";
        if (state == ProphetState.BURNED) return "burned";
        return "unknown";
    }
    
    function _calculatePriceChange(uint256 startPrice, uint256 endPrice) private pure returns (uint256) {
        if (startPrice == 0) return 0;
        uint256 diff = _abs(int256(endPrice) - int256(startPrice));
        return (diff * 10000) / startPrice; // Return in basis points
    }
    
    function _abs(int256 x) private pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }
    


    // ═══════════════════════════════════════════════════════════════════
    //                           ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function setBaseURI(string memory baseTokenURI) external onlyOwner {
        _baseTokenURI = baseTokenURI;
    }
    
    function setPriceOracle(address _priceOracle) external onlyOwner {
        priceOracle = _priceOracle;
    }
    
    function updateETHPrice(uint256 price) external onlyOwner {
        lastKnownETHPrice = price;
    }
    
    function emergencyWithdraw() external onlyOwner {
        // Only maintenance fee can be withdrawn
        require(address(this).balance >= MAINTENANCE_FEE, "No maintenance fee available");
        payable(owner()).transfer(MAINTENANCE_FEE);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          ROYALTY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    function royaltyInfo(uint256, uint256 salePrice) external pure override returns (address, uint256) {
        uint256 royaltyAmount = (salePrice * ROYALTY_FEE) / 10000;
        return (ROYALTY_RECEIVER, royaltyAmount);
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721A, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
    
    // Receive royalties
    receive() external payable {
        divineTreasury += msg.value;
    }
}0