// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
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

interface IProphetsRenderer {
    function images(string memory state) external view returns (string memory);
    function getDescription(string memory state) external pure returns (string memory);
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
    uint256 public constant MAX_SUPPLY = 666;
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
    // enum ProphetState {
    //     PROPHESIZING,  // 0 - Default meditation state (Sundays)
    //     BULLISH,       // 1 - Predict ETH rise
    //     BEARISH,       // 2 - Predict ETH fall
    //     BURNED         // 3 - Permanent
    // }

    struct CycleInfo {
        // Prices are 1e8 normalized
        uint64 startPrice;           // price logged at first prediction of the cycle (Sunday)
        uint64 startTime;           // Sunday 00:00 UTC start (first prediction timestamp)
        uint32 predictionsCount;    // unique tokens that predicted in this cycle
        // Extremes for tie-break and blessing
        uint256 lowestPredictionTokenId;  // smallest predicted price
        uint64 lowestPredictionPrice;
        uint256 highestPredictionTokenId; // largest predicted price
        uint64 highestPredictionPrice;
    }

    // ------------------------------
    // Storage
    // ------------------------------
    // Prediction per token per cycle (1e8 normalized); 0 = no prediction
    mapping(uint256 => mapping(uint256 => uint64)) public predictions; // tokenId => cycle => price
    // Mark tokens that were explicitly punished (e.g., listing infractions)
    mapping(uint256 => bool) public divinePunished;

    // Cycle data by cycle index starting at 1. Cycle 0 = pre-game.
    mapping(uint256 => CycleInfo) public cycles;
    // Blessed token (forever bullish winner) and cycle when blessed
    uint256 public blessedByDivine;
    uint256 public blessedAtCycle;

    // Renderer contract
    address public immutable renderer;
    
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
    uint256 public pythMaxAge = 3600; // 1 hour default
    uint256 public constant PYTH_MIN_MAX_AGE = 60; // 1 minute minimal

    // Mint lifecycle to determine first cycle start
    uint64 public mintCompleteTimestamp; // wall clock when mint out happens
    uint64 public firstCycleStart; // first Sunday 00:00 UTC at/after mintComplete
    bool public maintenanceWithdrawn;
    
    // Allowed operators for transfers - who needs ERC721C anyway?
    mapping(address => bool) public allowedOperators;

    // ------------------------------
    // Events
    // ------------------------------
    event PredictionMade(uint256 indexed tokenId, uint256 indexed cycle, uint64 startPrice, uint64 predictedPrice, bool bullish);
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
        address _renderer,
        address uniPool,
        address _approver,
        address _marketplace,
        address _pythContract
    ) ERC721A("Prophets of Ethereum", "PROPHET") EIP712("Prophets of Ethereum", "1") {
        renderer = _renderer;
        pool = uniPool;
        approver = _approver;
        marketplace = _marketplace;
        pythContract = _pythContract;
        
        // Automatically set marketplace as allowed operator
        if (_marketplace != address(0)) {
            allowedOperators[_marketplace] = true;
            emit OperatorAllowed(_marketplace, true);
        }
        
        emit OperatorAllowed(msg.sender, true);
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
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        require(msg.value == pricePerToken * amount, "Insufficient payment");
        
        bytes32 saleHash = keccak256(abi.encodePacked(msg.sender, saleId, endTime, maxMint, pricePerToken));
        require(_validateSignature(saleId, endTime, maxMint, pricePerToken, signature), "Invalid signature");
        require(mintedByHash[saleHash] + amount <= maxMint, "Exceeds max mint for this sale");
        
        mintedByHash[saleHash] += amount;
        _mint(msg.sender, amount);

        // if this completes mint-out, set firstCycleStart to this Sunday 00:00 UTC
        if (mintCompleteTimestamp == 0 && totalSupply() == MAX_SUPPLY) {
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
        uint256 calculatedCycle = 1 + (block.timestamp - uint256(firstCycleStart)) / 1 weeks;
        
        // If divine treasury was claimed, cycles stop at that point
        if (blessedAtCycle > 0) {
            return blessedAtCycle;
        }
        
        return calculatedCycle;
    }



    // Get ETH price from selected provider. Returns price scaled to 1e8.
    function _readCurrentPrice() internal view returns (uint64) {
        if (priceProvider == PriceProvider.PYTH) {
            return _readPythPriceInternal();
        } else if (priceProvider == PriceProvider.AMM) {
            return _readAMMPrice();
        } else {
            // PYTH_OR_AMM: try Pyth first, fallback to AMM
            try this.readPythPrice() returns (uint64 price) {
                return price;
            } catch {
                return _readAMMPrice();
            }
        }
    }
    
    // Public functions to read prices from each provider
    function readPythPrice() external view returns (uint64) {
        return _readPythPriceInternal();
    }
    
    function readAMMPrice() external view returns (uint64) {
        return _readAMMPrice();
    }
    
    function readCurrentPrice() external view returns (uint64) {
        return _readCurrentPrice();
    }
    
    // Pyth price feed. Returns ETH/USD price scaled to 1e8.
    function _readPythPriceInternal() internal view returns (uint64) {
        require(pythContract != address(0), "pyth-not-set");
        IPyth.Price memory price = IPyth(pythContract).getPriceNoOlderThan(pythPriceId, pythMaxAge);
        // Pyth returns price with expo, normalize to 1e8
        require(price.price > 0, "invalid-pyth-price");
        int64 normalizedPrice;
        if (price.expo >= -8) {
            normalizedPrice = price.price * int64(int256(10 ** uint256(int256(price.expo + 8))));
        } else {
            normalizedPrice = price.price / int64(int256(10 ** uint256(int256(-price.expo - 8))));
        }
        return uint64(normalizedPrice);
    }
    
    // Uniswap V2 spot price. Returns token1 per token0 scaled to 1e8.
    // Assumes pool tokens are WETH (18 decimals) and USDC.e (6 decimals). For other tokens, uses ERC20 decimals.
    function _readAMMPrice() internal view returns (uint64) {
        require(pool != address(0), "AMM pool not set");
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
        require(price1e8 <= type(uint64).max, "overflow");
        return uint64(price1e8);
    }

    // ------------------------------
    // Predictions
    // ------------------------------
    /// @notice Make or update a prediction for the current cycle during Sunday window.
    /// If this is the first prediction in the cycle, records the cycle's start price from AMM.
    /// The predicted price must differ by at least 1% from the cycle start price.
    function makePrediction(uint256 tokenId, uint64 predictedPrice)
        external
    {
        require(predictedPrice > 0, "Predicted price must be greater than 0");
        require(ownerOf(tokenId) == msg.sender, "Caller is not the owner of this token");
        require(!isBurned(tokenId), "This prophet has been burned and cannot make predictions");
        
        uint256 cycle = getCurrentCycle();
        require(cycle > 0, "Game has not started yet, wait for first cycle");
        require(_isInSundayWindow(), "Predictions can only be made during Sunday window (00:00-23:59 UTC)");
        
        CycleInfo storage info = cycles[cycle];

        // initialize cycle on first prediction
        if (info.startPrice == 0) {
            // Read on-chain current price at the Sunday window open
            uint64 sp = _readCurrentPrice();
            info.startPrice = sp;
            info.startTime = uint64(block.timestamp);
        }

        // enforce min difference
        uint64 startP = info.startPrice;
        require(startP != 0, "Cycle start price not initialized");

        uint256 absDiff = _absDiff(startP, predictedPrice);
        require(absDiff * 10000 >= uint256(startP) * MIN_PREDICTION_DIFF_BPS, "Prediction must differ by at least 1% from cycle start price");

        uint64 prevPrice = predictions[tokenId][cycle];
        bool firstForTokenThisCycle = prevPrice == 0;
        
        // Prevent changes if this token holds an extreme position
        if (!firstForTokenThisCycle) {
            require(info.lowestPredictionTokenId != tokenId, "Cannot change prediction: you hold the lowest position");
            require(info.highestPredictionTokenId != tokenId, "Cannot change prediction: you hold the highest position");
        }
        
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
    /// - Game must have ended
    /// - Caller must own the winning token
    function acceptDivineBlessing(uint256 gameEndedCycle) external {
        require(blessedByDivine == 0, "Divine treasury has already been claimed");
        require(mintCompleteTimestamp > 0, "Game is not ready yet");
        uint256 winnerId = getWinner(gameEndedCycle);
        require(ownerOf(winnerId) == msg.sender, "Caller does not own the winning prophet");

        uint256 currentCycle = getCurrentCycle();
        
        // Set blessed status BEFORE external call
        blessedByDivine = winnerId;
        blessedAtCycle = currentCycle;

        uint256 amount = getTreasury();
        require(amount > 0, "No treasury funds available to claim");
        
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Treasury transfer failed");

        emit DivineBlessingAccepted(currentCycle, winnerId, amount);
    }

    
    function withdrawMaintenanceFee(address payable to) external onlyOwner {
        require(!maintenanceWithdrawn, "done");
        require(address(this).balance >= MAINTENANCE_FEE, "insufficient");
        maintenanceWithdrawn = true;
        (bool ok, ) = to.call{value: MAINTENANCE_FEE}("");
        require(ok, "withdraw");
    }
    
    /// @notice Emergency withdrawal if winner doesn't claim blessing after 1 month of game ending
    /// @param gameEndedCycle The cycle where the game ended
    /// @param to Address to send the treasury to
    function emergencyWithdraw(uint256 gameEndedCycle, address payable to) external onlyOwner {
        // require(isGameEnded(), "game-not-ended"); already checked in getWinner
        // require(blessedByDivine == 0, "already-blessed"); doesn't matter, funds can still be stuck
        
        // Validate gameEndedCycle is correct by getting the winner (will revert if invalid)
        uint256 winnerId = getWinner(gameEndedCycle);
        require(winnerId > 0, "no-winner");
        
        // Calculate time since game ended, we don't need to add last cycle
        uint64 gameEndTime = uint64(uint256(firstCycleStart) + (gameEndedCycle - 1) * 1 weeks);
        uint256 daysPassed = (block.timestamp - gameEndTime) / 1 days;
        
        // Check if 1 month (28 days = 4 weeks) has passed since game ended
        require(daysPassed >= 28, "must-wait-28-days");
        
        uint256 amount = getTreasury();

        blessedAtCycle = gameEndedCycle;
        
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer");
    }

    // ------------------------------
    // Operator Management & OTC
    // ------------------------------
    function setAllowedOperator(address operator, bool allowed) external onlyOwner {
        allowedOperators[operator] = allowed;
        emit OperatorAllowed(operator, allowed);
    }

    // ------------------------------
    // Views
    // ------------------------------
    function maxSupply() public pure returns (uint256) {
        return MAX_SUPPLY;
    }

    function isGameEnded() public view returns (bool) {
        uint256 cycle = getCurrentCycle();
        if (cycle <= 1) return false; // need at least 1 started cycle
        
        // If we're in Sunday window, check 1 cycle back to avoid timing issues
        if (_isInSundayWindow()) {
            return cycles[cycle - 1].predictionsCount <= 1;
        }
        
        // Not in Sunday window - we can safely check the most recent started cycle
        return cycles[cycle].predictionsCount <= 1;
    }
    
    function _isInSundayWindow() internal view returns (bool) {
        uint256 cycle = getCurrentCycle();
        if (cycle == 0) return false;
        
        uint64 cycleStart = uint64(uint256(firstCycleStart) + (cycle - 1) * 1 weeks);
        return block.timestamp >= cycleStart && block.timestamp < cycleStart + 1 days;
    }
    
    /// @notice Determine the winner when game has ended
    /// @param gameEndedCycle The cycle where the game ended (last cycle with predictions)
    /// @return tokenId of the winning prophet
    function getWinner(uint256 gameEndedCycle) public view returns (uint256) {
        // if blessed, return blessed token
        if (blessedByDivine != 0) {
            return blessedByDivine;
        }
        require(isGameEnded(), "game-not-ended");
        // to validate gameEndedCycle is correct, we need to ensure next cycle has no predictions, but that the gameEndedCycle has predictions
        require(cycles[gameEndedCycle + 1].predictionsCount == 0, "next-cycle-has-predictions");
        CycleInfo storage endedCycleInfo = cycles[gameEndedCycle];
        require(endedCycleInfo.predictionsCount > 0, "no-predictions");
        
        // Since next cycle has no predictions, we can use the current price as judgment
        uint64 endPrice = _readCurrentPrice(); // current price as judgment
        
        // If ETH ended higher than start price, take highest prediction as winner
        // If only one survivor, they are both highest and lowest, so this works for both cases
        if (endPrice > endedCycleInfo.startPrice) {
            return endedCycleInfo.highestPredictionTokenId;
        }
        // Otherwise take lowest prediction as winner
        else {
            return endedCycleInfo.lowestPredictionTokenId;
        }
    }
    
    function isBurned(uint256 tokenId) public view returns (bool) {
        if (blessedByDivine == tokenId) return false;
        if (divinePunished[tokenId]) return true;

        // lets check if its sunday today
        bool isSunday = _isInSundayWindow();
        uint256 cycle = getCurrentCycle();
        if (cycle < 1) return false;

        if(isSunday) {
            if(cycle == 1) {
                return false;
            } else {
                uint256 last = cycle - 1;
                CycleInfo storage currentCycleInfo = cycles[cycle];
                uint64 pLast = predictions[tokenId][last];
                if (pLast == 0) return true; // made no prediction last cycle = burned
                // Need end price = next cycle's start price
                uint64 endPrice = currentCycleInfo.startPrice;
                // If current cycle hasn't started yet, calculate what the end price would be now
                if (endPrice == 0) {
                    endPrice = _readCurrentPrice(); // get current price as judgment
                }
                uint256 errBps = _priceChangeBps(endPrice, pLast);
                if (errBps > JUDGMENT_THRESHOLD_BPS) return true;
            }
        } else {
            uint64 pCurrent = predictions[tokenId][cycle];    
            if(pCurrent == 0) {
                return true;
            }
        }
        return false;
    }

    /// @notice Get the cycle when a prophet was burned (0 if not burned)
    /// @param tokenId The token ID to check
    /// @return The cycle number when the prophet was burned, 0 if not burned
    function getBurnCycle(uint256 tokenId) public view returns (uint256) {
        bool burned = isBurned(tokenId);
        require(burned, "Token is not burned");
        return _getBurnCycle(tokenId);
    }

    /// @notice Internal method to get burn cycle (assumes token is burned)
    /// @param tokenId The token ID to check
    /// @return The cycle number when the prophet was burned
    function _getBurnCycle(uint256 tokenId) private view returns (uint256) {
        uint256 currentCycle = getCurrentCycle();
        
        // Loop forwards through cycles to find first missing prediction
        for (uint256 cycle = 1; cycle < currentCycle; cycle++) {
            if (predictions[tokenId][cycle] == 0) {
                // Found first cycle with no prediction = they died this cycle
                return cycle;
            }
        }
        
        // If we get here, they made predictions all cycles but failed judgment in most recent
        return currentCycle;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "nf");
        
        string memory state = _getTokenState(tokenId);
        string memory imageData = IProphetsRenderer(renderer).images(state);
        string memory description = IProphetsRenderer(renderer).getDescription(state);
        
        // Build attributes with current cycle prediction if available
        string memory attributes = _buildAttributes(tokenId, state);
        
        string memory json = string(
            abi.encodePacked(
                '{"name":"Prophet #',
                tokenId.toString(),
                '","description":"',
                description,
                '","image":"',
                imageData,
                '","attributes":[',
                attributes,
                ']}'
            )
        );
        
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }
    
    function _getTokenState(uint256 tokenId) internal view returns (string memory) {
        if (isBurned(tokenId)) return "burned";
        if (blessedByDivine == tokenId) return "bullish";
        uint256 cycle = getCurrentCycle();
        if (cycle > 0 && predictions[tokenId][cycle] != 0) {
            bool up = predictions[tokenId][cycle] > cycles[cycle].startPrice;
            return up ? "bullish" : "bearish";
        }
        return "prophesizing";
    }
    
    /// @notice Check if a token is soulbound (non-transferable)
    /// @param tokenId The token ID to check
    /// @return true if the token is soulbound and cannot be transferred
    function isSoulbound(uint256 tokenId) public view returns (bool) {
        require(_exists(tokenId), "nf");
        // Burned tokens are soulbound
        return isBurned(tokenId);
    }
    
    /// @notice Build metadata attributes including current prediction
    /// @param tokenId The token ID
    /// @param state The current state
    /// @return JSON attributes string
    function _buildAttributes(uint256 tokenId, string memory state) internal view returns (string memory) {
        string memory attributes = string(abi.encodePacked('{"trait_type":"State","value":"', state, '"}'));
        
        // Blessed prophets trump everything
        if (blessedByDivine == tokenId) {
            attributes = string(abi.encodePacked(
                attributes,
                ',{"trait_type":"Divine Status","value":"Blessed"}'
            ));
        } else {
            if (keccak256(abi.encodePacked(state)) == keccak256(abi.encodePacked("burned"))) {
                // Burned prophets: add burn cycle and soulbound status
                uint256 burnCycle = _getBurnCycle(tokenId);
                attributes = string(abi.encodePacked(
                    attributes,
                    ',{"trait_type":"Burn Cycle","value":"', burnCycle.toString(), '"}'
                ));
            } else {
                // Alive prophets: add current cycle prediction if available
                uint256 cycle = getCurrentCycle();
                if (cycle > 0) {
                    uint64 prediction = predictions[tokenId][cycle];
                    if (prediction != 0) {
                        attributes = string(abi.encodePacked(
                            attributes,
                            ',{"trait_type":"Current Cycle","value":"', cycle.toString(), '"}',
                            ',{"trait_type":"Current Prediction","value":"', _formatPrice(prediction), '"}'
                        ));
                        
                        // Add cycle start price for context
                        CycleInfo storage cycleInfo = cycles[cycle];
                        if (cycleInfo.startPrice != 0) {
                            attributes = string(abi.encodePacked(
                                attributes,
                                ',{"trait_type":"Cycle Start Price","value":"', _formatPrice(cycleInfo.startPrice), '"}',
                                ',{"trait_type":"Prediction Direction","value":"', prediction > cycleInfo.startPrice ? "Bullish" : "Bearish", '"}'
                            ));
                        }
                    }
                }
            }
        }
        
        return attributes;
    }
    
    /// @notice Format price for display (1e8 normalized to readable format)
    /// @param price Price in 1e8 format
    /// @return formatted price string
    function _formatPrice(uint64 price) internal pure returns (string memory) {
        if (price == 0) return "$0.00";
        
        uint256 dollars = uint256(price) / 1e8;
        uint256 cents = (uint256(price) % 1e8) / 1e6; // Show 2 decimal places
        
        return string(abi.encodePacked("$", dollars.toString(), ".", _padZeros(cents, 2)));
    }
    
    /// @notice Pad number with leading zeros
    /// @param num Number to pad
    /// @param digits Target number of digits
    /// @return padded string
    function _padZeros(uint256 num, uint256 digits) internal pure returns (string memory) {
        string memory numStr = num.toString();
        bytes memory numBytes = bytes(numStr);
        
        if (numBytes.length >= digits) return numStr;
        
        bytes memory padded = new bytes(digits);
        uint256 padding = digits - numBytes.length;
        
        for (uint256 i = 0; i < padding; i++) {
            padded[i] = "0";
        }
        
        for (uint256 i = 0; i < numBytes.length; i++) {
            padded[padding + i] = numBytes[i];
        }
        
        return string(padded);
    }

    // ------------------------------
    // Admin
    // ------------------------------
    
    function setPriceProvider(PriceProvider _provider) external onlyOwner {
        priceProvider = _provider;
    }
    
    
    function setPythMaxAge(uint256 _maxAge) external onlyOwner {
        require(_maxAge >= PYTH_MIN_MAX_AGE, "below-min");
        pythMaxAge = _maxAge;
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
    // Transfer restrictions handled in _beforeTokenTransfers

    function _beforeTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal override {
        super._beforeTokenTransfers(from, to, startTokenId, quantity);
        // Skip checks for minting (from == address(0))
        if (from != address(0)) {
            // Check operator permissions
            require(allowedOperators[msg.sender] || msg.sender == from, "Caller is not an allowed operator or token owner");
            // Check soulbound status
            require(!isSoulbound(startTokenId), "Burned prophets are soulbound and cannot be transferred");
        }
    }

    function approve(address to, uint256 tokenId) public override payable {
        // block disallowed operators here if desired
        require(allowedOperators[to] || to == address(0), "Operator not allowed");
        super.approve(to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public override {
        require(!approved || allowedOperators[operator], "Operator not allowed");
        super.setApprovalForAll(operator, approved);
    }

    // maybe one day
    // function isApprovedForAll(address owner, address operator) public view override returns (bool) {
    //     // Auto-approve marketplace for all owners
    //     if (operator == marketplace && marketplace != address(0)) {
    //         return true;
    //     }
    //     return super.isApprovedForAll(owner, operator);
    // }

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

    function _priceChangeBps(uint64 a, uint64 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        return (_absDiff(a, b) * 10000) / uint256(a);
    }

    function _absDiff(uint64 a, uint64 b) internal pure returns (uint256) {
        return a > b ? uint256(a - b) : uint256(b - a);
    }

    // Mark a token as punished (e.g., listing below minimal floor in future extension)
    function _divinePunish(uint256 tokenId) internal {
        divinePunished[tokenId] = true;
    }

    // ------------------------------
    // Listing Punishment System
    // ------------------------------

    /// @notice Calculate minimal floor price: Divine Treasury ÷ Alive Prophets, but never below mint price
    /// @dev Uses current cycle predictions count, unless it's Sunday then uses previous cycle
    function getMinimalFloorPrice() public view returns (uint256) {
        uint256 cycle = getCurrentCycle();
        uint256 aliveProphets;
        
        if (cycle < 1) {
            // Pre-game or first cycle, all alive
            aliveProphets = totalSupply();
        } else {
            bool isSunday = _isInSundayWindow();
            // Check if it's currently Sunday (prediction window)
            if (isSunday) {
                if(cycle == 1) {
                    aliveProphets = totalSupply();
                } else {
                    aliveProphets = cycles[cycle - 1].predictionsCount;
                }
            } else {
                // Otherwise, use current cycle predictions count
                aliveProphets = cycles[cycle].predictionsCount;
            }
        }
        
        if (aliveProphets == 0) return MINT_PRICE;
        
        uint256 calculatedFloor = getTreasury() / aliveProphets;
        // Floor price cannot go below mint price
        return calculatedFloor > MINT_PRICE ? calculatedFloor : MINT_PRICE;
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
        
        // Verify that the provided fullHash actually matches the orderParameters using marketplace's hash function
        bytes32 computedHash = IMarketplace(marketplace).createOrderHash(orderParameters);
        require(computedHash == fullHash, "hash-mismatch");
        
        // Verify signature using SignatureChecker (supports both EOA and smart contract signatures)
        bool isValidSignature = SignatureChecker.isValidSignatureNow(tokenOwner, fullHash, signature);
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

