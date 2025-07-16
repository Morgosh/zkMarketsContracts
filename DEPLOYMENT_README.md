# 666 Prophets NFT Deployment Guide

## Overview

The 666 Prophets NFT is a dynamic NFT collection that changes state based on ETH price movements using **Pyth Network** oracle data. All 666 NFTs change state simultaneously based on ETH price vs a configurable baseline price.

## Key Features

- **Dynamic States**: 4 states based on ETH price performance vs baseline
  - BULLISH: +5% or more from baseline
  - NEUTRAL: Between -5% and +5% from baseline  
  - BEARISH: Between -5% and -10% from baseline
  - BONES_AND_ASHES: -10% or more from baseline
- **Pyth Network Integration**: Uses Pyth's pull-based oracle for real-time price data
- **Configurable Baseline**: Owner can update the baseline price for comparison
- **Dynamic Metadata**: NFT metadata updates automatically based on current state

## Prerequisites

1. **Yarn Package Manager** (this project uses Yarn, not npm)
2. **Hardhat Environment** configured for your target network
3. **Pyth Network** contract deployed on your target network

## Deployment Steps

### 1. Install Dependencies

```bash
yarn install
```

### 2. Configure Environment

Set up your `.env` file with:
- Private key for deployment
- Network RPC URLs
- Etherscan API keys (for verification)

### 3. Deploy to Abstract Chain

```bash
yarn hardhat deploy-zksync --script deploy_prophets_nft.ts
```

The deployment script will:
1. Deploy a MockPythExtended contract (for testing)
2. Set initial ETH price to $2000 (baseline)
3. Deploy ProphetsNFT contract with Pyth integration
4. Configure initial parameters

### 4. Verify Deployment

The contract will be automatically verified on block explorers if configured.

## Contract Architecture

### ProphetsNFT.sol

**Key Components:**
- `IPyth pyth`: Pyth Network oracle interface
- `bytes32 ethUsdPriceId`: ETH/USD price feed ID
- `int256 baselinePrice`: Configurable baseline for price comparison

**Main Functions:**
- `mint(uint256 quantity)`: Mint NFTs (0.02 ETH each)
- `getCurrentState(bytes[] calldata priceUpdateData)`: Get current state with price update
- `getCurrentStateView()`: View current state without updating prices
- `tokenURI(uint256 tokenId)`: Dynamic metadata generation

**Owner Functions:**
- `updateBaselinePrice(int256 _baselinePrice)`: Update price baseline
- `updatePythContract(address _pyth)`: Update Pyth contract address
- `updatePriceId(bytes32 _ethUsdPriceId)`: Update price feed ID
- `updateImages(...)`: Update state images

### MockPythExtended.sol

A testing contract that extends Pyth's MockPyth with helper functions:
- `setCurrentPrice(bytes32 id, int64 price)`: Set price for testing
- `setPrice(...)`: Set price with full parameters

## Pyth Network Integration

### Price Feed ID
- **ETH/USD**: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`

### How It Works
1. **Pull-based Oracle**: Users pull price updates on-demand
2. **Price Updates**: Call `updatePriceFeeds()` with signed price data
3. **State Calculation**: Compare current price vs baseline price
4. **Dynamic Metadata**: NFT metadata reflects current state

### Price Update Flow
```solidity
// Get price update data from Pyth price service
bytes[] memory priceUpdateData = getPriceUpdateData();

// Update prices and get current state
uint fee = pyth.getUpdateFee(priceUpdateData);
(ProphetState state, int256 change) = prophetsNFT.getCurrentState{value: fee}(priceUpdateData);
```

## Testing

Run the test suite:
```bash
yarn test
```

Tests cover:
- Contract deployment and initialization
- Minting functionality
- State management with different price scenarios
- Dynamic metadata generation
- Owner functions
- Edge cases and error handling

## Network Configuration

### Abstract Chain (Chain ID: 2741)
- **Pyth Contract**: Deploy MockPythExtended for testing
- **Gas Settings**: Optimized for Abstract chain
- **Verification**: Automatic via Hardhat

### Mainnet Deployment
For mainnet deployment, replace MockPythExtended with the actual Pyth contract address for your network.

## Important Notes

1. **Baseline Price**: Initially set to $2000 (200000000000 with 8 decimals)
2. **Price Staleness**: Prices older than 60 seconds are considered stale
3. **Mint Price**: 0.02 ETH per NFT (configurable in constructor)
4. **Max Supply**: 666 NFTs total
5. **Batch Limit**: Maximum 10 NFTs per transaction

## Troubleshooting

### Common Issues

1. **Price Too Stale**: Ensure price data is recent (< 60 seconds)
2. **Insufficient Fee**: Include proper fee for Pyth price updates
3. **Arithmetic Overflow**: Contract includes overflow protection
4. **BigInt Serialization**: Some deployment tools may have BigInt issues

### Support

For issues related to:
- **Pyth Network**: Check [Pyth Documentation](https://docs.pyth.network/)
- **Abstract Chain**: Refer to Abstract chain documentation
- **Contract Issues**: Review test files for examples

## Security Considerations

1. **Oracle Reliability**: Pyth Network provides institutional-grade data
2. **Price Manipulation**: Baseline price updates are owner-only
3. **Reentrancy**: Contract follows checks-effects-interactions pattern
4. **Access Control**: Uses OpenZeppelin's Ownable for admin functions

## Upgrade Path

The contract is not upgradeable by design. For updates:
1. Deploy new contract version
2. Migrate state if needed
3. Update frontend to use new contract

## Gas Optimization

- **State Calculation**: Done on-demand, no storage
- **Dynamic Metadata**: Generated in view functions
- **Batch Operations**: Support for multiple NFT mints
- **Efficient Comparisons**: Optimized price change calculations 