import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { getRPC } from "./utils";

dotenv.config();

interface SeaportOrderParameters {
  offerer: string;
  zone: string;
  offer: OfferItem[];
  consideration: ConsiderationItem[];
  orderType: number;
  startTime: string;
  endTime: string;
  zoneHash: string;
  salt: string;
  conduitKey: string;
  totalOriginalConsiderationItems: number;
  counter: string;
}

interface OfferItem {
  itemType: number;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
}

interface ConsiderationItem {
  itemType: number;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
  recipient: string;
}

interface OpenSeaFee {
  fee: number;
  recipient: string;
  required: boolean;
}

interface CollectionData {
  fees: OpenSeaFee[];
}

interface OrderPayload {
  parameters: SeaportOrderParameters;
  signature: string;
  protocol_address: string;
}

const SEAPORT_ABI = [
  "function getCounter(address offerer) external view returns (uint256 counter)"
];

const ERC721C_ABI = [
  "function supportsInterface(bytes4 interfaceId) external view returns (bool)"
];

const ERC721_ABI = [
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",
  "function setApprovalForAll(address operator, bool approved) external"
];

// ERC721C interface ID
const ERC721C_INTERFACE_ID = "0xad092b5c";

const NETWORK_CHAIN_IDS = {
  mainnet: 1,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  abstract: 2741
};

const CONDUIT_KEYS = {
  general: "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000",
  abstract: "0x61159fefdfada89302ed55f8b9e89e2d67d8258712b3a3f89aa88525877f1d5e"
};

const PROTOCOL_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395"; // Seaport 1.6
const ERC721C_ZONE = "0x000056f7000000ece9003ca63978907a00ffd100";

// Known OpenSea fee recipients (platform fees)
const OPENSEA_FEE_RECIPIENTS = [
  "0x0000a26b00c1f0df003000390027140000faa719", // OpenSea fee recipient
  "0x8de9c5a032463c561423387a9648c5c7bcc5bc90"  // Another known OpenSea recipient
];

function parseArgs(): {
  network: string;
  collection: string;
  tokenId: string;
  priceEth: string;
  slug: string;
  removePlatformFees?: boolean;
  removeCollectionFees?: boolean;
  dry?: boolean;
  erc721c?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: any = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "removePlatformFees" || key === "removeCollectionFees" || key === "dry" || key === "erc721c") {
        parsed[key] = true;
      } else {
        parsed[key] = args[i + 1];
        i++;
      }
    }
  }

  if (!parsed.network || !parsed.collection || !parsed.tokenId || !parsed.priceEth || !parsed.slug) {
    console.error("Missing required arguments: --network --collection --tokenId --priceEth --slug");
    process.exit(1);
  }

  if (!Object.keys(NETWORK_CHAIN_IDS).includes(parsed.network)) {
    console.error("Invalid network. Supported: mainnet, polygon, base, arbitrum, optimism, abstract");
    process.exit(1);
  }

  return parsed;
}

async function fetchCollectionFees(slug: string): Promise<OpenSeaFee[]> {
  const response = await fetch(`https://api.opensea.io/api/v2/collections/${slug}`, {
    headers: {
      "x-api-key": process.env.OPENSEA_API_KEY!
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch collection data: ${response.status} ${response.statusText}`);
  }

  const data: CollectionData = await response.json();
  return data.fees || [];
}

function filterFees(fees: OpenSeaFee[], removePlatformFees: boolean, removeCollectionFees: boolean): OpenSeaFee[] {
  return fees.filter(fee => {
    const shouldRemove = (removePlatformFees && isPlatformFee(fee)) || (removeCollectionFees && !isPlatformFee(fee));
    
    if (shouldRemove) {
      if (fee.required) {
        const feeType = isPlatformFee(fee) ? "platform" : "creator";
        console.warn(`Warning: Removing required ${feeType} fee for recipient ${fee.recipient}`);
      }
      return false;
    }

    return true;
  });
}

function isPlatformFee(fee: OpenSeaFee): boolean {
  return OPENSEA_FEE_RECIPIENTS.includes(fee.recipient.toLowerCase());
}

function getRPCForNetwork(network: string): string {
  return getRPC(network);
}

function buildOrder(
  collection: string,
  tokenId: string,
  priceWei: bigint,
  fees: OpenSeaFee[],
  offerer: string,
  network: string,
  counter: bigint,
  isERC721C: boolean
): SeaportOrderParameters {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 60; // 1 minute from now
  const endTime = now + 7 * 24 * 60 * 60; // 7 days from now

  // Calculate fee amounts
  const feeAmounts = fees.map(fee => {
    // OpenSea API returns fees as percentages (0.5 = 0.5%, 5 = 5%)
    // Convert percentage to basis points: 0.5% = 50 bps, 5% = 500 bps
    const feeBps = Math.floor(fee.fee * 100);
    const feeWei = (priceWei * BigInt(feeBps)) / 10000n;
    return { recipient: fee.recipient, amount: feeWei };
  });

  const totalFees = feeAmounts.reduce((sum, fee) => sum + fee.amount, 0n);
  const sellerProceeds = priceWei - totalFees;

  if (sellerProceeds <= 0n) {
    throw new Error("Seller proceeds must be greater than 0 after fees");
  }

  // Build offer (NFT)
  const offer: OfferItem[] = [{
    itemType: 2, // ERC721
    token: collection,
    identifierOrCriteria: tokenId,
    startAmount: "1",
    endAmount: "1"
  }];

  // Build consideration (payments)
  const consideration: ConsiderationItem[] = [
    // Seller proceeds
    {
      itemType: 0, // Native token
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: "0",
      startAmount: sellerProceeds.toString(),
      endAmount: sellerProceeds.toString(),
      recipient: offerer
    },
    // Fee payments
    ...feeAmounts.map(fee => ({
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: "0",
      startAmount: fee.amount.toString(),
      endAmount: fee.amount.toString(),
      recipient: fee.recipient
    }))
  ];

  const conduitKey = network === "abstract" ? CONDUIT_KEYS.abstract : CONDUIT_KEYS.general;

  // ERC721C contracts require specific order type and zone
  const orderType = isERC721C ? 2 : 0; // FULL_RESTRICTED (2) for ERC721C, FULL_OPEN (0) for standard
  const zone = isERC721C ? ERC721C_ZONE : "0x0000000000000000000000000000000000000000";
  
  console.log(`Building order with orderType: ${orderType}, zone: ${zone}, isERC721C: ${isERC721C}`);

  return {
    offerer,
    zone,
    offer,
    consideration,
    orderType,
    startTime: startTime.toString(),
    endTime: endTime.toString(),
    zoneHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    salt: ethers.randomBytes(32).reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "0x"),
    conduitKey,
    totalOriginalConsiderationItems: consideration.length,
    counter: counter.toString()
  };
}

async function signOrder(parameters: SeaportOrderParameters, privateKey: string, network: string): Promise<string> {
  const wallet = new ethers.Wallet(privateKey);

  const chainId = NETWORK_CHAIN_IDS[network as keyof typeof NETWORK_CHAIN_IDS];
  const domain = {
    name: "Seaport",
    version: "1.6",
    chainId,
    verifyingContract: PROTOCOL_ADDRESS
  };
  
  console.log(`Signing with domain:`, JSON.stringify(domain, null, 2));
  console.log(`Order parameters for signing:`, JSON.stringify(parameters, null, 2));

  const types = {
    OrderComponents: [
      { name: "offerer", type: "address" },
      { name: "zone", type: "address" },
      { name: "offer", type: "OfferItem[]" },
      { name: "consideration", type: "ConsiderationItem[]" },
      { name: "orderType", type: "uint8" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "zoneHash", type: "bytes32" },
      { name: "salt", type: "uint256" },
      { name: "conduitKey", type: "bytes32" },
      { name: "counter", type: "uint256" }
    ],
    OfferItem: [
      { name: "itemType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" },
      { name: "endAmount", type: "uint256" }
    ],
    ConsiderationItem: [
      { name: "itemType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" },
      { name: "endAmount", type: "uint256" },
      { name: "recipient", type: "address" }
    ]
  };

  // For EIP-712 signing, use OrderComponents struct (exclude totalOriginalConsiderationItems)
  const { totalOriginalConsiderationItems, ...orderComponents } = parameters;
  
  console.log(`OrderComponents for EIP-712 signing:`, JSON.stringify(orderComponents, null, 2));
  
  return await wallet.signTypedData(domain, types, orderComponents);
}

function displayOrderDetails(order: OrderPayload, priceEth: string, fees: OpenSeaFee[]): void {
  console.log("\n=== DRY RUN - ORDER DETAILS ===");
  console.log(`Price: ${priceEth} ETH (${ethers.parseEther(priceEth).toString()} wei)`);
  console.log(`Offerer: ${order.parameters.offerer}`);
  console.log(`Collection: ${order.parameters.offer[0].token}`);
  console.log(`Token ID: ${order.parameters.offer[0].identifierOrCriteria}`);
  
  console.log("\nFees:");
  fees.forEach((fee, index) => {
    const feeType = isPlatformFee(fee) ? "Platform" : "Creator";
    console.log(`  ${index + 1}. ${feeType} Fee: ${fee.fee}% to ${fee.recipient} (required: ${fee.required})`);
  });

  console.log("\nConsideration (payments):");
  order.parameters.consideration.forEach((item, index) => {
    const ethAmount = ethers.formatEther(item.startAmount);
    const isSellerPayment = item.recipient === order.parameters.offerer;
    const paymentType = isSellerPayment ? "Seller proceeds" : "Fee payment";
    console.log(`  ${index + 1}. ${paymentType}: ${ethAmount} ETH to ${item.recipient}`);
  });

  console.log(`\nOrder Type: ${order.parameters.orderType}`);
  console.log(`Start Time: ${new Date(parseInt(order.parameters.startTime) * 1000).toISOString()}`);
  console.log(`End Time: ${new Date(parseInt(order.parameters.endTime) * 1000).toISOString()}`);
  console.log(`Counter: ${order.parameters.counter}`);
  console.log(`Signature: ${order.signature.slice(0, 10)}...${order.signature.slice(-8)}`);
  console.log("===============================\n");
}

async function submitOrder(order: OrderPayload, network: string): Promise<string> {
  // Map network names to OpenSea API chain names
  const networkToOpenSeaChain: Record<string, string> = {
    mainnet: "ethereum",
    polygon: "polygon",
    base: "base", 
    arbitrum: "arbitrum",
    optimism: "optimism",
    abstract: "abstract"
  };
  
  const openSeaChain = networkToOpenSeaChain[network];
  if (!openSeaChain) {
    throw new Error(`Network ${network} not supported by OpenSea API`);
  }
  
  const response = await fetch(`https://api.opensea.io/api/v2/orders/${openSeaChain}/seaport/listings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": process.env.OPENSEA_API_KEY!
    },
    body: JSON.stringify(order)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`API Error: ${response.status} ${response.statusText}`);
    console.error(`Response: ${errorText}`);
    throw new Error(`OpenSea API error: ${response.status}`);
  }

  const result = await response.json();
  if (result.order_hash) {
    console.log(`Order created successfully! Order hash: ${result.order_hash}`);
    return result.order_hash;
  } else {
    console.log("Order submitted:", JSON.stringify(result, null, 2));
    return "submitted";
  }
}

async function isERC721C(contractAddress: string, network: string): Promise<boolean> {
  try {
    const rpcUrl = getRPCForNetwork(network);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(contractAddress, ERC721C_ABI, provider);
    
    // Check the most common ERC721C interface ID
    const result = await contract.supportsInterface("0x2f8ca953");
    return result;
  } catch (error) {
    console.log(`Could not check ERC721C interface for ${contractAddress}, assuming standard ERC721`);
    return false;
  }
}

async function checkAndApproveConduit(
  collectionAddress: string, 
  offerer: string, 
  network: string, 
  conduitKey: string
): Promise<void> {
  const rpcUrl = getRPCForNetwork(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const nftContract = new ethers.Contract(collectionAddress, ERC721_ABI, provider);
  
  // Get the conduit address from the conduit key
  // For now, we'll use the known conduit addresses
  const conduitAddresses: Record<string, string> = {
    [CONDUIT_KEYS.general]: "0x1E0049783F008A0085193E00003D00cd54003c71",
    [CONDUIT_KEYS.abstract]: "0x1E0049783F008A0085193E00003D00cd54003c71" // Same for abstract
  };
  
  const conduitAddress = conduitAddresses[conduitKey];
  if (!conduitAddress) {
    console.log(`Warning: Unknown conduit key ${conduitKey}, skipping approval check`);
    return;
  }
  
  console.log(`Checking if conduit ${conduitAddress} is approved for collection ${collectionAddress}`);
  
  try {
    const isApproved = await nftContract.isApprovedForAll(offerer, conduitAddress);
    
    if (isApproved) {
      console.log(`✅ Conduit is already approved`);
    } else {
      console.log(`❌ Conduit is NOT approved`);
      console.log(`\nTo fix this, you need to approve the conduit:`);
      console.log(`1. Go to https://etherscan.io/address/${collectionAddress}#writeContract`);
      console.log(`2. Connect your wallet (${offerer})`);
      console.log(`3. Call setApprovalForAll with:`);
      console.log(`   - operator: ${conduitAddress}`);
      console.log(`   - approved: true`);
      console.log(`\nOr you can approve it programmatically by uncommenting the approval code in the script.`);
      
      // Uncomment these lines if you want automatic approval (requires wallet with gas)
      // console.log("Attempting to approve conduit...");
      // const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
      // const nftContractWithSigner = nftContract.connect(wallet);
      // const tx = await nftContractWithSigner.setApprovalForAll(conduitAddress, true);
      // console.log(`Approval transaction: ${tx.hash}`);
      // await tx.wait();
      // console.log("Conduit approved successfully!");
    }
  } catch (error) {
    console.log(`Could not check conduit approval: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getSeaportCounter(offerer: string, network: string): Promise<bigint> {
  const rpcUrl = getRPCForNetwork(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const seaportContract = new ethers.Contract(PROTOCOL_ADDRESS, SEAPORT_ABI, provider);
  
  return await seaportContract.getCounter(offerer);
}

async function main() {
  try {
    const args = parseArgs();
    
    if (!process.env.OPENSEA_API_KEY) {
      throw new Error("OPENSEA_API_KEY environment variable is required");
    }

    if (!process.env.PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY environment variable is required");
    }

    console.log(`Creating listing for ${args.collection}#${args.tokenId} at ${args.priceEth} ETH on ${args.network}`);

    // Convert price to wei
    const priceWei = ethers.parseEther(args.priceEth);
    
    // Get wallet address
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const offerer = wallet.address;

    // Fetch collection fees
    console.log("Fetching collection fees...");
    const allFees = await fetchCollectionFees(args.slug);
    
    // Filter fees based on flags
    const fees = filterFees(allFees, !!args.removePlatformFees, !!args.removeCollectionFees);
    
    console.log(`Using ${fees.length} fees out of ${allFees.length} total fees`);

    // Check if contract is ERC721C
    let isERC721CContract: boolean;
    if (args.erc721c) {
      console.log("ERC721C flag provided - using restricted order type");
      isERC721CContract = true;
    } else {
      console.log("Checking contract type...");
      isERC721CContract = await isERC721C(args.collection, args.network);
      if (isERC721CContract) {
        console.log("Detected ERC721C contract - using restricted order type");
      }
    }

    // Get counter from Seaport contract
    console.log("Getting counter from Seaport contract...");
    const counter = await getSeaportCounter(offerer, args.network);

    // Build order
    console.log("Building order...");
    const parameters = buildOrder(
      args.collection,
      args.tokenId,
      priceWei,
      fees,
      offerer,
      args.network,
      counter,
      isERC721CContract
    );

    // Check conduit approval
    console.log("Checking conduit approval...");
    await checkAndApproveConduit(args.collection, offerer, args.network, parameters.conduitKey);

    // Sign order
    console.log("Signing order...");
    const signature = await signOrder(parameters, process.env.PRIVATE_KEY, args.network);

    // Create order payload
    const orderPayload: OrderPayload = {
      parameters,
      signature,
      protocol_address: PROTOCOL_ADDRESS
    };

    if (args.dry) {
      console.log("DRY RUN MODE - Order will not be submitted");
      displayOrderDetails(orderPayload, args.priceEth, fees);
      console.log("To submit this order, run the same command without --dry flag");
    } else {
      // Submit order
      console.log("Submitting order to OpenSea...");
      await submitOrder(orderPayload, args.network);
    }

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
