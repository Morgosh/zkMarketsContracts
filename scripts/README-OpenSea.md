# OpenSea Listing Script

## Setup

1. Set environment variables:
```bash
OPENSEA_API_KEY=your_opensea_api_key
PRIVATE_KEY=your_private_key_for_signing
```

2. Install dependencies (already done):
```bash
yarn install
```

## Usage

```bash
yarn ts-node scripts/listOnOpenSea.ts --network mainnet --collection 0x1234... --tokenId 123 --priceEth 1.5 --slug collection-slug
```

### Required Flags:
- `--network`: mainnet|polygon|base|arbitrum|optimism|abstract
- `--collection`: Contract address (0x...)
- `--tokenId`: Token ID as string
- `--priceEth`: Price in ETH as string
- `--slug`: Collection slug for fee lookup

### Optional Flags:
- `--removePlatformFees`: Remove OpenSea platform fees (if not required)
- `--removeCollectionFees`: Remove creator/collection fees (if not required)
- `--dry`: Dry run mode - display order details without submitting
- `--erc721c`: Force ERC721C mode (use restricted order type and zone)

## Examples

Basic listing:
```bash
yarn ts-node scripts/listOnOpenSea.ts --network mainnet --collection 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D --tokenId 1 --priceEth 10.0 --slug boredapeyachtclub
```

Remove platform fees:
```bash
yarn ts-node scripts/listOnOpenSea.ts --network mainnet --collection 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D --tokenId 1 --priceEth 10.0 --slug boredapeyachtclub --removePlatformFees
```

Remove both platform and collection fees:
```bash
yarn ts-node scripts/listOnOpenSea.ts --network mainnet --collection 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D --tokenId 1 --priceEth 10.0 --slug boredapeyachtclub --removePlatformFees --removeCollectionFees
```

Dry run (preview order without submitting):
```bash
yarn ts-node scripts/listOnOpenSea.ts --network mainnet --collection 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D --tokenId 1 --priceEth 10.0 --slug boredapeyachtclub --dry
```

ERC721C contract (force restricted order type):
```bash
yarn ts-node scripts/listOnOpenSea.ts --network mainnet --collection 0x1d4c28d4d484f494f58869192bc8de56c384c0f0 --tokenId 289 --priceEth 1.0 --slug moody-mights --erc721c
```
