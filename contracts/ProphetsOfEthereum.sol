// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
// Pyth removed; using on-chain AMM spot price instead

interface IUniswapV2PairMinimal {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title Prophets of Ethereum
/// @notice Weekly prediction game with on-chain judgment using Pyth prices (Abstract)
/// @dev ERC721A, token IDs start at 1. Minimal, gas-conscious implementation sized for 666 supply.
contract ProphetsOfEthereum is ERC721A, Ownable, IERC2981 {
    using Strings for uint256;

    // ------------------------------
    // Constants
    // ------------------------------
    uint256 public constant TOTAL_SUPPLY = 666;
    uint256 public constant MINT_PRICE = 0.01 ether;
    uint256 public constant MAINTENANCE_FEE = 1 ether;
    uint256 public constant JUDGMENT_THRESHOLD_BPS = 1000; // 10%
    uint256 public constant MIN_PREDICTION_DIFF_BPS = 100; // 1%
    uint256 public constant LISTING_GRACE_PERIOD = 1 hours; // reserved (not implemented yet)

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
        // Prices are 1e8 normalized (like Pyth price with expo -8)
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

    // Global (cycle index computed via getCurrentCycle)

    // Treasury tracking
    bool public maintenanceWithdrawn;

    // Metadata base
    string private baseImageURI;

    // AMM Pool (WETH/USDC.E) Uniswap V2 pair address
    address public immutable pool;

    // Mint lifecycle to determine first cycle start
    bool public mintComplete; // becomes true when totalSupply == 666
    uint64 public mintCompleteTimestamp; // wall clock when mint out happens
    uint64 public firstCycleStart; // first Sunday 00:00 UTC at/after mintComplete

    // ------------------------------
    // Events
    // ------------------------------
    event PredictionMade(uint256 indexed tokenId, uint256 indexed cycle, int64 startPrice, int64 predictedPrice, bool bullish);
    // no explicit judgment event/function — state is computed
    event DivineBlessingAccepted(uint256 indexed cycle, uint256 indexed tokenId, uint256 amount);
    event Minted(address indexed to, uint256 quantity, uint256 paid, uint256 treasuryAfter);

    // ------------------------------
    // Constructor
    // ------------------------------
    constructor(
        string memory _baseImageURI,
        address uniPool
    ) ERC721A("Prophets of Ethereum", "PROPHET") {
        baseImageURI = _baseImageURI;
        pool = uniPool;
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
    function mint(uint256 quantity) external payable {
        require(quantity > 0, "qty=0");
        require(totalSupply() + quantity <= TOTAL_SUPPLY, "supply");
        require(msg.value == MINT_PRICE * quantity, "price");

        _mint(msg.sender, quantity);

        // Treasury is just contract balance; maintenance fee handled on withdraw

        // if this completes mint-out, set firstCycleStart to next Sunday 00:00 UTC
        if (!mintComplete && totalSupply() == TOTAL_SUPPLY) {
            mintComplete = true;
            mintCompleteTimestamp = uint64(block.timestamp);
            firstCycleStart = _nextSunday00UTC(mintCompleteTimestamp);
            // first cycle index becomes 1 when Sunday window opens
        }

        emit Minted(msg.sender, quantity, msg.value, getTreasury());
    }

    function withdrawMaintenanceFee(address payable to) external onlyOwner {
        require(!maintenanceWithdrawn, "done");
        require(address(this).balance >= MAINTENANCE_FEE, "insufficient");
        maintenanceWithdrawn = true;
        (bool ok, ) = to.call{value: MAINTENANCE_FEE}("");
        require(ok, "withdraw");
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
        if (!mintComplete) return 0;
        if (block.timestamp < firstCycleStart) return 0;
        // weeks elapsed since first cycle start; cycle index starts at 1
        return 1 + (block.timestamp - uint256(firstCycleStart)) / 1 weeks;
    }

    function _ensureCycleWindow() internal {
        uint256 cycle = getCurrentCycle();
        require(cycle > 0, "no-cycle");
        // recompute window bounds
        uint64 cycleStart = uint64(uint256(firstCycleStart) + (cycle - 1) * 1 weeks);
        // Sunday window: from cycleStart to cycleStart + 1 day
        require(block.timestamp >= cycleStart && block.timestamp < cycleStart + 1 days, "not-sunday");
    }

    // Uniswap V2 spot price. Returns token1 per token0 scaled to 1e8.
    // Assumes pool tokens are WETH (18 decimals) and USDC.e (6 decimals). For other tokens, uses ERC20 decimals.
    function _readPoolSpotPrice() internal view returns (int64) {
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
    /// If this is the first prediction in the cycle, records the cycle's start price from Pyth.
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
    /// - If exactly one prediction last cycle and they survived, they can claim.
    /// - If zero predictions, the token among the recorded extremes (lowest/highest) closest to endPrice can claim.
    function acceptDivineBlessing() external {
        require(blessedByDivine == 0, "blessed");
        require(mintComplete, "not-ready");

        uint256 cycle = getCurrentCycle();
        require(cycle > 1, "no-cycle");
        uint256 last = cycle - 1; // evaluate last completed cycle

        CycleInfo storage info = cycles[last];
        int64 endPrice = cycles[cycle].startPrice; // end price of last = next cycle start price
        require(endPrice != int64(0), "no-judgment");

        uint256 winnerTokenId;

        if (info.predictionsCount == 1) {
            // find the only token that predicted and survived
            uint256 nextId = _nextTokenId();
            for (uint256 t = _startTokenId(); t < nextId; t++) {
                if (predictions[t][last] != int64(0) && !isBurned(t)) {
                    winnerTokenId = t;
                    break;
                }
            }
        } else if (info.predictionsCount == 0) {
            // choose closest among extremes to endPrice
            require(info.lowestPredictionTokenId != 0 || info.highestPredictionTokenId != 0, "no-extremes");
            uint256 lowTok = info.lowestPredictionTokenId;
            uint256 highTok = info.highestPredictionTokenId;
            uint256 lowErr = info.lowestPredictionTokenId == 0 ? type(uint256).max : _absDiffU(endPrice, info.lowestPredictionPrice);
            uint256 highErr = info.highestPredictionTokenId == 0 ? type(uint256).max : _absDiffU(endPrice, info.highestPredictionPrice);
            winnerTokenId = lowErr <= highErr ? lowTok : highTok;
        } else {
            revert("multi");
        }

        require(winnerTokenId != 0, "no-winner");
        require(ownerOf(winnerTokenId) == msg.sender, "owner");

        blessedByDivine = winnerTokenId;
        // winner shown as bullish in tokenURI via blessedByDivine

        uint256 amount = getTreasury();
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer");

        emit DivineBlessingAccepted(cycle, winnerTokenId, amount);
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
        // Need end price = next cycle's start price
        int64 endPrice = cycles[cycle].startPrice;
        if (endPrice == int64(0)) return false; // next cycle not started yet => no judgment

        // Lazy check based on stored predictions
        int64 pLast = predictions[tokenId][last];
        if (pLast == int64(0)) return true; // made no prediction last cycle

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
    // Receive royalties and donations -> divineTreasury
    // ------------------------------
    receive() external payable {
        // Treasury is implicit via balance; nothing to do
    }

    // ------------------------------
    // Internal utils
    // ------------------------------
    function _nextSunday00UTC(uint64 fromTs) internal pure returns (uint64) {
        // days since epoch, where Thursday Jan 1 1970 is day 0; Sunday index = 0 in ((ts/86400)+4)%7
        uint64 dayStart = fromTs - (fromTs % 86400); // 00:00 UTC of that day
        uint64 weekday = ((dayStart / 86400) + 4) % 7; // Sunday=0
        if (weekday == 0 && fromTs == dayStart) {
            return dayStart; // already Sunday 00:00
        }
        uint64 daysToSunday = (7 - weekday) % 7;
        if (fromTs != dayStart) {
            // if not exactly 00:00, ensure we go to next day's boundary
            daysToSunday = (daysToSunday == 0) ? 7 : daysToSunday; // move to next Sunday
        }
        return dayStart + daysToSunday * 86400;
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
    // NOTE: Minimal floor price listing burn is intentionally omitted for now as requested.
    // It can be added later with onList hooks and grace period enforcement against a computed floor = treasury / alive.
    // ------------------------------
}

