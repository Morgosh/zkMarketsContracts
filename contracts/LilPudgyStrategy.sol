// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 *
 * LilPudgyStrategy
 * $LILPDGYSTR
 * Website: https://www.eskimoonabs.com/
 * Twitter: https://x.com/EskimoOnAbs
 * 
 * Features:
 * - 10% fee on DEX trades (configurable)
 * - 80/20 split to treasury/dev wallets
 * - Anti-whale limits (max tx/wallet)
 * - Auto swap-back on sells
 * - Manual swap control
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
    ) external;
}

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address);
}

contract V2FeeToken is ERC20, Ownable {
    // ====== Config ======
    uint16 public constant MAX_FEE_BPS = 1000;        // 10% hard cap
    uint16 public constant BPS_DENOM = 10000;         // 100% in basis points
    uint16 public totalFeeBps = 1000;                 // 10% default
    uint16 public treasuryShareBps = 8000;            // 80% of ETH to treasury (rest to dev)

    address payable public treasury;
    address payable public devWallet;

    IUniswapV2Router02 public router;
    address public pair;      // Uniswap V2 pair (market)
    address public WETH;

    bool public tradingEnabled = false;
    mapping(address => bool) public feeExempt;
    mapping(address => bool) public isMarket; // mark the pair (or more if needed)

    // swap-back
    bool public swapEnabled = true;
    bool private inSwap;
    uint256 public swapThreshold; // in token units
    uint256 public maxSwapAmount; // cap per swap

    // anti-whale limits
    uint256 public maxWallet;          // in token wei
    uint256 public maxTx;              // in token wei
    bool    public limitsEnabled = true;
    mapping(address => bool) public limitExempt;

    // ====== Events ======
    event FeesUpdated(uint16 totalFeeBps, uint16 treasuryShareBps);
    event WalletsUpdated(address indexed treasury, address indexed dev);
    event MarketSet(address indexed account, bool isMarket);
    event FeeExemptSet(address indexed account, bool isExempt);
    event TradingEnabled();
    event SwapSettingsSet(uint256 threshold, uint256 maxSwap, bool enabled);
    event SwapBackExecuted(uint256 tokensSold, uint256 ethReceived, uint256 toTreasury, uint256 toDev);
    event LimitsUpdated(uint256 maxTx, uint256 maxWallet, bool enabled);
    event LimitExemptSet(address indexed account, bool isExempt);
    event FeeSplitUpdated(uint16 treasuryShareBps);

    modifier lockTheSwap() {
        inSwap = true;
        _;
        inSwap = false;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,                  // e.g. 1_000_000_000 * 1e18
        address payable treasury_,
        address payable dev_,
        address router_                         // Abstract: Mainnet 0xad1eCa41E6F772bE3cb5A48A6141f9bcc1AF9F7c
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(treasury_ != address(0) && dev_ != address(0), "zero wallet");

        treasury = treasury_;
        devWallet = dev_;

        router = IUniswapV2Router02(router_);
        WETH = router.WETH();

        // Create the V2 pair (token <-> WETH)
        pair = IUniswapV2Factory(router.factory()).createPair(address(this), WETH);
        isMarket[pair] = true;

        // Mint supply to deployer
        _mint(msg.sender, initialSupply);

        // Fee exemptions
        feeExempt[address(this)] = true;
        feeExempt[msg.sender] = true;
        feeExempt[treasury] = true;
        feeExempt[devWallet] = true;

        // Swap settings: 1 token threshold, 1 token max swap
        swapThreshold = 1000 * 10**18;     // 1 token
        maxSwapAmount = 1000000 * 10**18;     // 1 token

        // Anti-whale limits: 3% max wallet, 1% max tx
        maxWallet = (initialSupply * 3) / 100;   // 3% of supply
        maxTx     = (initialSupply * 1) / 100;   // 1% of supply
        
        // Limit exemptions (DO NOT exempt the pair)
        limitExempt[owner()] = true;
        limitExempt[address(this)] = true;
        limitExempt[treasury] = true;
        limitExempt[devWallet] = true;
    }

    // ====== Core transfer with fees ======
    function _update(address from, address to, uint256 amount) internal override {
        // owner can always move pre-launch
        if (!tradingEnabled && from != owner() && to != owner()) {
            revert("Trading disabled");
        }

        bool marketFrom = isMarket[from];
        bool marketTo   = isMarket[to];

        // Apply anti-whale limits first
        _enforceTransactionLimits(from, to, amount, marketFrom, marketTo);

        // Determine if fee should be taken
        bool shouldTakeFee = tradingEnabled
            && !feeExempt[from]
            && !feeExempt[to]
            && (marketFrom || marketTo);

        // Execute swap-back on sells (simple and reliable)
        if (swapEnabled && !inSwap && marketTo && from != address(this)) {
            _swapBack();
        }

        // Process transfer with or without fees
        if (!shouldTakeFee) {
            super._update(from, to, amount);
            return;
        }

        uint256 feeAmount = (amount * totalFeeBps) / BPS_DENOM;
        uint256 transferAmount = amount - feeAmount;

        // Transfer fee to contract and net amount to recipient
        super._update(from, address(this), feeAmount);
        super._update(from, to, transferAmount);
    }

    // ====== Anti-whale limit enforcement ======
    function _enforceTransactionLimits(
        address from, 
        address to, 
        uint256 amount, 
        bool marketFrom, 
        bool marketTo
    ) private view {
        // Ignore internal/contract flows to avoid maxTx reverts during swapback
        if (inSwap || from == address(this) || to == address(this)) {
            return;
        }
        
        if (!limitsEnabled || !tradingEnabled) {
            return;
        }
        
        // Only skip when BOTH sides are exempt (owner<->treasury moves, etc.)
        if (limitExempt[from] && limitExempt[to]) {
            return;
        }

        // Check max transaction limit
        require(amount <= maxTx, "max tx");
        
        // Check max wallet limit for recipients (except when selling to pair)
        if (!marketTo) {
            uint256 potentialFee = 0;
            bool hasMarketFee = !feeExempt[from] && !feeExempt[to] && (marketFrom || marketTo);
            if (hasMarketFee) { 
                potentialFee = (amount * totalFeeBps) / BPS_DENOM;
            }
            uint256 finalAmount = amount - potentialFee;
            require(balanceOf(to) + finalAmount <= maxWallet, "max wallet");
        }
    }

    // ====== Swap-back: sell tokens -> ETH and split ======
    function _swapBack() private lockTheSwap {
        uint256 tokenBal = balanceOf(address(this));
        if (tokenBal < swapThreshold) return;

        uint256 amountToSwap = tokenBal > maxSwapAmount ? maxSwapAmount : tokenBal;

        // approve router once (gas-optimized to skip if already enough)
        _approve(address(this), address(router), amountToSwap);

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = WETH;

        uint256 pre = address(this).balance;
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountToSwap, 0, path, address(this), block.timestamp
        );
        uint256 got = address(this).balance - pre;
        if (got == 0) return;

        // split 80/20 of the ETH received
        uint256 toTreasury = (got * treasuryShareBps) / BPS_DENOM;
        uint256 toDev = got - toTreasury;

        (bool s1,) = treasury.call{value: toTreasury}("");
        (bool s2,) = devWallet.call{value: toDev}("");
        require(s1 && s2, "payout failed");

        emit SwapBackExecuted(amountToSwap, got, toTreasury, toDev);
    }

    // ====== Admin ======
    function enableTrading() external onlyOwner {
        tradingEnabled = true;
        emit TradingEnabled();
    }

    function setFeeBps(uint16 newTotal) external onlyOwner {
        require(newTotal <= MAX_FEE_BPS, "fee too high");
        totalFeeBps = newTotal;
        emit FeesUpdated(newTotal, treasuryShareBps);
    }

    function setFeeSplit(uint16 newTreasuryShareBps) external onlyOwner {
        require(newTreasuryShareBps <= BPS_DENOM, "bad split");
        treasuryShareBps = newTreasuryShareBps;
        emit FeeSplitUpdated(newTreasuryShareBps);
    }

    function setWallets(address payable newTreasury, address payable newDev) external onlyOwner {
        require(newTreasury != address(0) && newDev != address(0), "zero");
        treasury = newTreasury;
        devWallet = newDev;
        feeExempt[newTreasury] = true;
        feeExempt[newDev] = true;
        emit WalletsUpdated(newTreasury, newDev);
    }

    function setMarket(address account, bool v) external onlyOwner {
        isMarket[account] = v;
        emit MarketSet(account, v);
    }

    function setFeeExempt(address account, bool v) external onlyOwner {
        feeExempt[account] = v;
        emit FeeExemptSet(account, v);
    }

    function setSwapSettings(uint256 threshold, uint256 maxAmt, bool enabled) external onlyOwner {
        swapThreshold = threshold;
        maxSwapAmount = maxAmt;
        swapEnabled = enabled;
        emit SwapSettingsSet(threshold, maxAmt, enabled);
    }

    function setLimits(uint256 newMaxTx, uint256 newMaxWallet, bool enabled) external onlyOwner {
        require(newMaxTx > 0 && newMaxWallet > 0, "zero");
        require(newMaxWallet >= newMaxTx, "wallet<tx");
        maxTx = newMaxTx;
        maxWallet = newMaxWallet;
        limitsEnabled = enabled;
        emit LimitsUpdated(newMaxTx, newMaxWallet, enabled);
    }

    function setLimitExempt(address account, bool v) external onlyOwner {
        limitExempt[account] = v;
        emit LimitExemptSet(account, v);
    }

    function manualSwap(uint256 amount) external onlyOwner lockTheSwap {
        uint256 bal = balanceOf(address(this));
        if (amount == 0 || amount > bal) amount = bal;
        if (bal == 0) return;

        _approve(address(this), address(router), amount);
        
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = WETH;

        uint256 pre = address(this).balance;
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amount, 0, path, address(this), block.timestamp
        );
        uint256 got = address(this).balance - pre;

        if (got > 0) {
            uint256 toTreasury = (got * treasuryShareBps) / BPS_DENOM;
            uint256 toDev = got - toTreasury;
            (bool s1,) = treasury.call{value: toTreasury}("");
            (bool s2,) = devWallet.call{value: toDev}("");
            require(s1 && s2, "payout failed");
        }
    }

    function setRouter(address newRouter) external onlyOwner {
        router = IUniswapV2Router02(newRouter);
        WETH = router.WETH();
        // NOTE: pair stays the same unless you recreate it; you can create & mark additional markets if needed
    }

    // rescue
    function rescueETH(uint256 amount) external onlyOwner {
        (bool ok,) = owner().call{value: amount}("");
        require(ok, "rescue fail");
    }
    
    function rescueToken(address token, uint256 amount) external onlyOwner {
        require(token != address(this), "no");
        ERC20(token).transfer(owner(), amount);
    }

    receive() external payable {}
}