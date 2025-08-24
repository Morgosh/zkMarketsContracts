// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./IMarketplace.sol";
// Using on-chain AMM spot price

interface IUniswapV2PairMinimal {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory price);
}

enum PriceProvider {
    AMM,           // 0 - Uniswap V2 AMM only
    PYTH,          // 1 - Pyth Network only
    PYTH_OR_AMM    // 2 - Try Pyth first, fallback to AMM
}

/// @title Prophets of Ethereum
/// @notice Weekly prediction game with on-chain judgment using AMM prices
/// @dev ERC721A, token IDs start at 1. Minimal, gas-conscious implementation sized for 666 supply.
contract ProphetsOfEthereum is ERC721A, Ownable, IERC2981, EIP712 {
    using Strings for uint256;
    using ECDSA for bytes32;

    // ------------------------------
    // Constants
    // ------------------------------
    uint256 public constant TOTAL_SUPPLY = 666;
    uint256 public constant MINT_PRICE = 0.01 ether;
    uint256 public constant MAINTENANCE_FEE = 1 ether;
    uint256 public constant JUDGMENT_THRESHOLD_BPS = 1000; // 10%
    uint256 public constant MIN_PREDICTION_DIFF_BPS = 100; // 1%
    uint256 public constant LISTING_GRACE_PERIOD = 1 hours;
    
    // EIP-712 type hash for signature minting
    bytes32 private constant MINT_TYPEHASH = keccak256("Mint(address user,uint256 saleId,uint256 endTime,uint256 maxMint,uint256 pricePerToken)");

    // Royalties
    uint96 public constant ROYALTY_FEE = 500; // 5% in basis points

    // ------------------------------
    // Types
    // ------------------------------
    enum ProphetState {
        PROPHESIZING,  // 0 - Default meditation state (Sundays)
        BULLISH,       // 1 - Predict ETH rise
        BEARISH,       // 2 - Predict ETH fall
        BURNED         // 3 - Permanent
    }

    struct CycleInfo {
        // Prices are 1e8 normalized
        int64 startPrice;           // price logged at first prediction of the cycle (Sunday)
        uint64 startTime;           // Sunday 00:00 UTC start (first prediction timestamp)
        uint64 endTime;             // Sunday 00:00 UTC end of week (start + 7 days)
        uint32 predictionsCount;    // unique tokens that predicted in this cycle
        // Extremes for tie-break and blessing
        uint256 lowestPredictionTokenId;  // smallest predicted price
        int64 lowestPredictionPrice;
        uint256 highestPredictionTokenId; // largest predicted price
        int64 highestPredictionPrice;
    }

    // ------------------------------
    // Storage
    // ------------------------------
    // Prediction per token per cycle (1e8 normalized); 0 = no prediction
    mapping(uint256 => mapping(uint256 => int64)) public predictions; // tokenId => cycle => price
    // Mark tokens that were explicitly punished (e.g., listing infractions)
    mapping(uint256 => bool) public divinePunished;

    // Cycle data by cycle index starting at 1. Cycle 0 = pre-game.
    mapping(uint256 => CycleInfo) public cycles;
    // Blessed token (forever bullish winner)
    uint256 public blessedByDivine;

    // Metadata base
    string private baseImageURI;
    
    // Signature minting
    address public approver;
    mapping(bytes32 => uint256) public mintedByHash;
    
    // Marketplace integration
    address public immutable marketplace;

    // Price provider configuration
    PriceProvider public priceProvider = PriceProvider.PYTH_OR_AMM; // Default to Pyth with AMM fallback
    address public immutable pool; // AMM Pool (WETH/USDC.E) Uniswap V2 pair
    address public pythContract;
    bytes32 public pythPriceId = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace; // ETH/USD
    uint256 public constant PYTH_MAX_AGE = 86400; // 24 hours

    // Mint lifecycle to determine first cycle start
    uint64 public mintCompleteTimestamp; // wall clock when mint out happens
    uint64 public firstCycleStart; // first Sunday 00:00 UTC at/after mintComplete
    bool public maintenanceWithdrawn;
    
    // Allowed operators for transfers - who needs ERC721C anyway?
    mapping(address => bool) public allowedOperators;

    // ------------------------------
    // Events
    // ------------------------------
    event PredictionMade(uint256 indexed tokenId, uint256 indexed cycle, int64 startPrice, int64 predictedPrice, bool bullish);
    // no explicit judgment event/function — state is computed
    event DivineBlessingAccepted(uint256 indexed cycle, uint256 indexed tokenId, uint256 amount);
    event Minted(address indexed to, uint256 quantity, uint256 paid, uint256 treasuryAfter);
    event OperatorAllowed(address indexed operator, bool allowed);
    event UnfaithfulPunished(uint256 indexed tokenId, uint256 listingPrice, uint256 minimalFloor, address punisher);
    event MintWithSignature(address indexed to, uint256 amount, bytes32 indexed saleHash);
    event ApproverUpdated(address indexed oldApprover, address indexed newApprover);

    // ------------------------------
    // Constructor
    // ------------------------------
    constructor(
        string memory _baseImageURI,
        address uniPool,
        address _approver,
        address _marketplace,
        address _defaultOperator
    ) ERC721A("Prophets of Ethereum", "PROPHET") EIP712("Prophets of Ethereum", "1") {
        baseImageURI = _baseImageURI;
        pool = uniPool;
        approver = _approver;
        marketplace = _marketplace;
        pythContract = 0x8739d5024B5143278E2b15Bd9e7C26f6CEc658F1; // Pyth mainnet
        
        // Set default whitelisted operator
        if (_defaultOperator != address(0)) {
            allowedOperators[_defaultOperator] = true;
            emit OperatorAllowed(_defaultOperator, true);
        }
    }

    // ------------------------------
    // ERC721A config
    // ------------------------------
    function _startTokenId() internal pure override returns (uint256) {
        return 1; // start at id 1
    }

    // ------------------------------
    // Minting
    // ------------------------------
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
        require(totalSupply() + amount <= TOTAL_SUPPLY, "Exceeds max supply");
        require(msg.value == pricePerToken * amount, "Insufficient payment");
        
        bytes32 saleHash = keccak256(abi.encodePacked(msg.sender, saleId, endTime, maxMint, pricePerToken));
        require(_validateSignature(saleId, endTime, maxMint, pricePerToken, signature), "Invalid signature");
        require(mintedByHash[saleHash] + amount <= maxMint, "Exceeds max mint for this sale");
        
        mintedByHash[saleHash] += amount;
        _mint(msg.sender, amount);

        // if this completes mint-out, set firstCycleStart to next Sunday 00:00 UTC
        if (mintCompleteTimestamp == 0 && totalSupply() == TOTAL_SUPPLY) {
            mintCompleteTimestamp = uint64(block.timestamp);
            firstCycleStart = _nextSunday00UTC(mintCompleteTimestamp);
            // first cycle index becomes 1 when Sunday window opens
        }
        
        emit MintWithSignature(msg.sender, amount, saleHash);
        emit Minted(msg.sender, amount, msg.value, getTreasury());
    }

    function _validateSignature(
        uint256 saleId,
        uint256 endTime,
        uint256 maxMint,
        uint256 pricePerToken,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(
            MINT_TYPEHASH,
            msg.sender,
            saleId,
            endTime,
            maxMint,
            pricePerToken
        ));
        
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        
        return signer == approver;
    }

    function getTreasury() public view returns (uint256) {
        if (maintenanceWithdrawn) return address(this).balance;
        if (address(this).balance <= MAINTENANCE_FEE) return 0;
        return address(this).balance - MAINTENANCE_FEE;
    }

    // ------------------------------
    // Cycles
    // ------------------------------
    function getCurrentCycle() public view returns (uint256) {
        if (mintCompleteTimestamp == 0) return 0;
        if (block.timestamp < firstCycleStart) return 0;
        // weeks elapsed since first cycle start; cycle index starts at 1
        return 1 + (block.timestamp - uint256(firstCycleStart)) / 1 weeks;
    }

    function _ensureCycleWindow() internal view {
        uint256 cycle = getCurrentCycle();
        require(cycle > 0, "no-cycle");
        // recompute window bounds
        uint64 cycleStart = uint64(uint256(firstCycleStart) + (cycle - 1) * 1 weeks);
        // Sunday window: from cycleStart to cycleStart + 1 day
        require(block.timestamp >= cycleStart && block.timestamp < cycleStart + 1 days, "not-sunday");
    }

    // Get ETH price from selected provider. Returns price scaled to 1e8.
    function _readPoolSpotPrice() internal view returns (int64) {
        if (priceProvider == PriceProvider.PYTH) {
            return _readPythPriceInternal();
        } else if (priceProvider == PriceProvider.AMM) {
            return _readAMMPrice();
        } else {
            // PYTH_OR_AMM: try Pyth first, fallback to AMM
            try this._readPythPrice() returns (int64 price) {
                return price;
            } catch {
                return _readAMMPrice();
            }
        }
    }
    
    // External wrapper for Pyth price (used in try/catch)
    function _readPythPrice() external view returns (int64) {
        return _readPythPriceInternal();
    }
    
    // Pyth price feed. Returns ETH/USD price scaled to 1e8.
    function _readPythPriceInternal() internal view returns (int64) {
        require(pythContract != address(0), "pyth-not-set");
        IPyth.Price memory price = IPyth(pythContract).getPriceNoOlderThan(pythPriceId, PYTH_MAX_AGE);
        // Pyth returns price with expo, normalize to 1e8
        int64 normalizedPrice;
        if (price.expo >= -8) {
            normalizedPrice = price.price * int64(int256(10 ** uint256(int256(price.expo + 8))));
        } else {
            normalizedPrice = price.price / int64(int256(10 ** uint256(int256(-price.expo - 8))));
        }
        require(normalizedPrice > 0, "invalid-pyth-price");
        return normalizedPrice;
    }
    
    // Uniswap V2 spot price. Returns token1 per token0 scaled to 1e8.
    // Assumes pool tokens are WETH (18 decimals) and USDC.e (6 decimals). For other tokens, uses ERC20 decimals.
    function _readAMMPrice() internal view returns (int64) {
        (uint112 r0, uint112 r1, ) = IUniswapV2PairMinimal(pool).getReserves();
        address t0 = IUniswapV2PairMinimal(pool).token0();
        address t1 = IUniswapV2PairMinimal(pool).token1();
        uint8 d0 = 18;
        uint8 d1 = 6;
        // attempt to read decimals, ignore failures
        try IERC20Metadata(t0).decimals() returns (uint8 dec0) { d0 = dec0; } catch {}
        try IERC20Metadata(t1).decimals() returns (uint8 dec1) { d1 = dec1; } catch {}
        require(r0 > 0 && r1 > 0, "res");
        // price token1 per token0 = (r1 * 10^d0) / (r0 * 10^d1)
        uint256 num = uint256(r1) * (10 ** d0) * 1e8;
        uint256 den = uint256(r0) * (10 ** d1);
        uint256 price1e8 = num / den;
        require(price1e8 <= uint256(uint64(type(int64).max)), "overflow");
        return int64(int256(price1e8));
    }

    // ------------------------------
    // Predictions
    // ------------------------------
    /// @notice Make or update a prediction for the current cycle during Sunday window.
    /// If this is the first prediction in the cycle, records the cycle's start price from AMM.
    /// The predicted price must differ by at least 1% from the cycle start price.
    function makePrediction(uint256 tokenId, int64 predictedPrice)
        external
        payable
    {
        require(ownerOf(tokenId) == msg.sender, "owner");
        require(!isBurned(tokenId), "burned");
        _ensureCycleWindow();

        uint256 cycle = getCurrentCycle();
        CycleInfo storage info = cycles[cycle];

        // initialize cycle on first prediction
        if (info.startPrice == int64(0)) {
            // Read on-chain pool spot price at the Sunday window open
            int64 sp = _readPoolSpotPrice();
            info.startPrice = sp;
            info.startTime = uint64(block.timestamp);
            // Boundaries useful for UI
            info.endTime = uint64(uint256(firstCycleStart) + cycle * 1 weeks);
        }

        // enforce min difference
        int64 startP = info.startPrice;
        require(startP != int64(0), "no-start");

        uint256 absDiff = _absDiff(startP, predictedPrice);
        require(absDiff * 10000 >= uint256(int256(startP)) * MIN_PREDICTION_DIFF_BPS, "min-diff");

        int64 prevPrice = predictions[tokenId][cycle];
        bool firstForTokenThisCycle = prevPrice == int64(0);
        predictions[tokenId][cycle] = predictedPrice;

        // no persistent state; direction is derived in tokenURI/isBurned

        // track extremes
        if (firstForTokenThisCycle) {
            info.predictionsCount += 1;
        }
        if (info.lowestPredictionTokenId == 0 || predictedPrice < info.lowestPredictionPrice) {
            info.lowestPredictionTokenId = tokenId;
            info.lowestPredictionPrice = predictedPrice;
        }
        if (info.highestPredictionTokenId == 0 || predictedPrice > info.highestPredictionPrice) {
            info.highestPredictionTokenId = tokenId;
            info.highestPredictionPrice = predictedPrice;
        }

        emit PredictionMade(tokenId, cycle, startP, predictedPrice, predictedPrice > startP);
    }

    // No executeJudgment — judgment computed in isBurned() using next cycle's startPrice as end price of previous

    /// @notice Winner claims the divine treasury and becomes blessed forever.
    /// - Must be Monday or later (cycle judgment available)
    /// - Exactly 1 prediction was made last cycle and that token survived
    /// - Caller must own the winning token
    function acceptDivineBlessing(uint256 tokenId) external {
        require(blessedByDivine == 0, "blessed");
        require(mintCompleteTimestamp > 0, "not-ready");
        require(ownerOf(tokenId) == msg.sender, "owner");

        uint256 cycle = getCurrentCycle();
        require(cycle > 1, "no-cycle");
        uint256 last = cycle - 1; // evaluate last completed cycle

        CycleInfo storage info = cycles[last];
        int64 endPrice = cycles[cycle].startPrice; // end price of last = next cycle start price
        require(endPrice != int64(0), "no-judgment");

        // Must be exactly 1 prediction last cycle
        require(info.predictionsCount == 1, "not-single");
        
        // This token must have made the prediction and survived
        require(predictions[tokenId][last] != int64(0), "no-prediction");
        require(!isBurned(tokenId), "burned");

        // Set blessed status BEFORE external call
        blessedByDivine = tokenId;

        uint256 amount = getTreasury();
        require(amount > 0, "no-treasury");
        
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer");

        emit DivineBlessingAccepted(cycle, tokenId, amount);
    }

    
    function withdrawMaintenanceFee(address payable to) external onlyOwner {
        require(!maintenanceWithdrawn, "done");
        require(address(this).balance >= MAINTENANCE_FEE, "insufficient");
        maintenanceWithdrawn = true;
        (bool ok, ) = to.call{value: MAINTENANCE_FEE}("");
        require(ok, "withdraw");
    }

    // ------------------------------
    // Operator Management & OTC
    // ------------------------------
    function setAllowedOperator(address operator, bool allowed) external onlyOwner {
        allowedOperators[operator] = allowed;
        emit OperatorAllowed(operator, allowed);
    }



    modifier onlyAllowedOperator(address from) {
        if (from != address(0)) {
            // Allow if sender is an allowed operator OR if sender is the token owner (OTC)
            require(allowedOperators[msg.sender] || msg.sender == from, "not-allowed");
        }
        _;
    }

    // ------------------------------
    // Views
    // ------------------------------
    function isBurned(uint256 tokenId) public view returns (bool) {
        if (blessedByDivine == tokenId) return false;
        if (divinePunished[tokenId]) return true;

        uint256 cycle = getCurrentCycle();
        if (cycle < 2) return false; // need at least one completed cycle
        uint256 last = cycle - 1;
        CycleInfo storage prev = cycles[last];
        
        // Lazy check based on stored predictions
        int64 pLast = predictions[tokenId][last];
        if (pLast == int64(0)) return true; // made no prediction last cycle = burned

        // Need end price = next cycle's start price
        int64 endPrice = cycles[cycle].startPrice;
        // If current cycle hasn't started yet, calculate what the end price would be now
        if (endPrice == int64(0)) {
            endPrice = _readPoolSpotPrice(); // get current price as judgment
        }

        bool wentUp = endPrice > prev.startPrice;
        bool predictedUp = pLast > prev.startPrice;
        uint256 errBps = _priceChangeBps(pLast, endPrice);
        bool correctDir = (wentUp && predictedUp) || (!wentUp && !predictedUp);
        if (!correctDir || errBps > JUDGMENT_THRESHOLD_BPS) return true;
        return false;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "nf");
        if (isBurned(tokenId)) return _buildMetadata(tokenId, "burned");
        if (blessedByDivine == tokenId) return _buildMetadata(tokenId, "bullish");
        uint256 cycle = getCurrentCycle();
        if (cycle > 0 && predictions[tokenId][cycle] != int64(0)) {
            bool up = predictions[tokenId][cycle] > cycles[cycle].startPrice;
            return _buildMetadata(tokenId, up ? "bullish" : "bearish");
        }
        return _buildMetadata(tokenId, "prophesizing");
    }

    function _buildMetadata(uint256 tokenId, string memory stateKey) internal view returns (string memory) {
        string memory json = string(
            abi.encodePacked(
                '{"name":"Prophet #',
                tokenId.toString(),
                '","description":"Prophets of Ethereum.",',
                '"image":"', baseImageURI, stateKey, '.png",',
                '"attributes":[{"trait_type":"State","value":"', stateKey, '"}]}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    // ------------------------------
    // Admin
    // ------------------------------
    function setBaseImageURI(string calldata uri) external onlyOwner { baseImageURI = uri; }
    
    function setPriceProvider(PriceProvider _provider) external onlyOwner {
        priceProvider = _provider;
    }
    
    function setPythContract(address _pythContract) external onlyOwner {
        pythContract = _pythContract;
    }
    
    function setPythPriceId(bytes32 _priceId) external onlyOwner {
        pythPriceId = _priceId;
    }
    
    function setApprover(address newApprover) external onlyOwner {
        require(newApprover != address(0), "Invalid approver address");
        
        address oldApprover = approver;
        approver = newApprover;
        
        emit ApproverUpdated(oldApprover, newApprover);
    }

    // ------------------------------
    // Royalties (EIP-2981)
    // ------------------------------
    function royaltyInfo(uint256, uint256 salePrice) external view override returns (address, uint256) {
        uint256 amount = (salePrice * ROYALTY_FEE) / 10000;
        return (address(this), amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721A, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    // ------------------------------
    // Transfer Overrides
    // ------------------------------
    function transferFrom(address from, address to, uint256 tokenId) public payable override onlyAllowedOperator(from) {
        super.transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public payable override onlyAllowedOperator(from) {
        super.safeTransferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public payable override onlyAllowedOperator(from) {
        super.safeTransferFrom(from, to, tokenId, data);
    }

    // ------------------------------
    // Receive royalties and donations -> divineTreasury
    // ------------------------------
    receive() external payable {
        // Treasury is implicit via balance; nothing to do
    }

    // ------------------------------
    // Internal utils
    // ------------------------------
    function _nextSunday00UTC(uint64 fromTs) internal pure returns (uint64) {
        uint64 day = fromTs / 86400;         // whole days since epoch
        uint64 dayStart = day * 86400;       // 00:00 UTC of that day
        uint64 w = (day + 4) % 7;            // 0=Sun, 1=Mon, ..., 6=Sat
        uint64 addDays = (7 - w) % 7;        // 0 if Sunday, else days until Sunday
        return dayStart + addDays * 86400;
    }

    function _priceChangeBps(int64 a, int64 b) internal pure returns (uint256) {
        if (a == int64(0)) return 0;
        uint256 ua = uint256(int256(a < 0 ? -a : a));
        uint256 ub = uint256(int256(b < 0 ? -b : b));
        uint256 diff = ua > ub ? ua - ub : ub - ua;
        return (diff * 10000) / ua;
    }

    function _absDiff(int64 a, int64 b) internal pure returns (uint256) {
        int256 d = int256(a) - int256(b);
        return uint256(d >= 0 ? d : -d);
    }

    function _absDiffU(int64 a, int64 b) internal pure returns (uint256) {
        return _absDiff(a, b);
    }

    // Mark a token as punished (e.g., listing below minimal floor in future extension)
    function _divinePunish(uint256 tokenId) internal {
        divinePunished[tokenId] = true;
    }

    // ------------------------------
    // Listing Punishment System
    // ------------------------------

    /// @notice Calculate minimal floor price: Divine Treasury ÷ Alive Prophets
    function getMinimalFloorPrice() public view returns (uint256) {
        uint256 aliveProphets = getAliveProphetsCount();
        if (aliveProphets == 0) return 0;
        return getTreasury() / aliveProphets;
    }

    /// @notice Count alive prophets based on previous cycle submissions
    /// @dev Always uses previous cycle submission count
    function getAliveProphetsCount() public view returns (uint256) {
        uint256 cycle = getCurrentCycle();
        if (cycle <= 1) return totalSupply(); // Pre-game or first cycle, all alive
        
        // Always use previous cycle submissions
        uint256 prevCycle = cycle - 1;
        return cycles[prevCycle].predictionsCount;
    }

    /// @notice Punish unfaithful prophets who list below minimal floor price
    /// @dev Anyone can submit order parameters and signature from marketplace to burn NFT if listed below floor
    /// @dev Punishment only valid within 1 hour of order creation to protect from retroactive burns
    function punishUnfaithful(
        IMarketplace.OrderParameters calldata orderParameters,
        bytes calldata signature,
        bytes32 fullHash
    ) external {
        // Verify the order is for an NFT from this collection
        require(orderParameters.offer.itemType == IMarketplace.ItemType.NFT, "not-nft");
        require(orderParameters.offer.tokenAddress == address(this), "wrong-collection");
        require(orderParameters.orderType == IMarketplace.BasicOrderType.ERC721_FOR_ETH, "wrong-type");
        
        uint256 tokenId = orderParameters.offer.identifier;
        require(!isBurned(tokenId), "already-burned");
        
        // Verify signature matches the current owner
        address tokenOwner = ownerOf(tokenId);
        require(orderParameters.offerer == tokenOwner, "not-owner");
        
        // Verify signature via marketplace contract
        bool isValidSignature = IMarketplace(marketplace).verifySignature(fullHash, signature, tokenOwner);
        require(isValidSignature, "invalid-signature");
        
        // Check that order is within 1 hour grace period
        require(block.timestamp <= orderParameters.createdTime + LISTING_GRACE_PERIOD, "grace-period-expired");
        
        // Check if listing price is below minimal floor
        uint256 listingPrice = orderParameters.consideration.amount;
        uint256 minimalFloor = getMinimalFloorPrice();
        require(listingPrice < minimalFloor, "above-minimal-floor");
        
        // Divine punishment: burn the unfaithful prophet
        _divinePunish(tokenId);
        
        emit UnfaithfulPunished(tokenId, listingPrice, minimalFloor, msg.sender);
    }
}

