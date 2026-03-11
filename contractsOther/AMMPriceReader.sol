// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IUniswapV2PairMinimal {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
}

contract AMMPriceReader {
    address public pool;
    
    constructor(address _pool) {
        pool = _pool;
    }
    
    function setPool(address _pool) external {
        pool = _pool;
    }
    
    function readAMMPrice() external view returns (uint64) {
        return _readAMMPrice();
    }
    
    function getPoolInfo() external view returns (
        address token0,
        address token1,
        string memory token0Symbol,
        string memory token1Symbol,
        uint8 token0Decimals,
        uint8 token1Decimals,
        uint112 reserve0,
        uint112 reserve1
    ) {
        (uint112 r0, uint112 r1, ) = IUniswapV2PairMinimal(pool).getReserves();
        address t0 = IUniswapV2PairMinimal(pool).token0();
        address t1 = IUniswapV2PairMinimal(pool).token1();
        
        uint8 d0 = 18;
        uint8 d1 = 6;
        string memory s0 = "UNKNOWN";
        string memory s1 = "UNKNOWN";
        
        try IERC20Metadata(t0).decimals() returns (uint8 dec0) { d0 = dec0; } catch {}
        try IERC20Metadata(t1).decimals() returns (uint8 dec1) { d1 = dec1; } catch {}
        try IERC20Metadata(t0).symbol() returns (string memory sym0) { s0 = sym0; } catch {}
        try IERC20Metadata(t1).symbol() returns (string memory sym1) { s1 = sym1; } catch {}
        
        return (t0, t1, s0, s1, d0, d1, r0, r1);
    }
    
    function _readAMMPrice() internal view returns (uint64) {
        if (pool == address(0)) return 0;
        
        (uint112 r0, uint112 r1, ) = IUniswapV2PairMinimal(pool).getReserves();
        address t0 = IUniswapV2PairMinimal(pool).token0();
        address t1 = IUniswapV2PairMinimal(pool).token1();
        uint8 d0 = 18;
        uint8 d1 = 6;
        
        // attempt to read decimals, ignore failures
        try IERC20Metadata(t0).decimals() returns (uint8 dec0) { d0 = dec0; } catch {}
        try IERC20Metadata(t1).decimals() returns (uint8 dec1) { d1 = dec1; } catch {}
        
        require(r0 > 0 && r1 > 0, "No reserves");
        
        // price token1 per token0 = (r1 * 10^d0) / (r0 * 10^d1)
        uint256 num = uint256(r1) * (10 ** d0) * 1e8;
        uint256 den = uint256(r0) * (10 ** d1);
        uint256 price1e8 = num / den;
        require(price1e8 <= type(uint64).max, "Price overflow");
        return uint64(price1e8);
    }
    
    function debugCalculation() external view returns (
        uint112 r0,
        uint112 r1,
        uint8 d0,
        uint8 d1,
        uint256 num,
        uint256 den,
        uint256 price1e8,
        uint64 finalPrice
    ) {
        (r0, r1, ) = IUniswapV2PairMinimal(pool).getReserves();
        address t0 = IUniswapV2PairMinimal(pool).token0();
        address t1 = IUniswapV2PairMinimal(pool).token1();
        d0 = 18;
        d1 = 6;
        
        try IERC20Metadata(t0).decimals() returns (uint8 dec0) { d0 = dec0; } catch {}
        try IERC20Metadata(t1).decimals() returns (uint8 dec1) { d1 = dec1; } catch {}
        
        if (r0 > 0 && r1 > 0) {
            num = uint256(r1) * (10 ** d0) * 1e8;
            den = uint256(r0) * (10 ** d1);
            price1e8 = num / den;
            if (price1e8 <= type(uint64).max) {
                finalPrice = uint64(price1e8);
            }
        }
    }
}
