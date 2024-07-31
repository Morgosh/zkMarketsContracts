export enum paymasterTypes {
  Moody = "moody",
  Hue = "hue",
  Zeek = "zeek",
  WeBears = "weBears",
  FrenzyFrogs = "frenzyFrogs",
}

export interface PaymasterOptions {
  paymasterAddress?: string
  type: "erc20" | "sponsor"
  tokenAddress?: string
  gatedErc721Address?: string
  sponsorAmount?: number
  limitToFunctions?: string[]
  apiKey?: string
}

export enum GlobalModalTypes {
  OFFER_STEP_1,
  CANCEL_OFFER,
  ACCEPT_OFFER,
  TRANSFER_NFT,
}

export enum ItemType {
  NFT,
  ERC20,
  ETH,
}

export enum BasicOrderType {
  ERC721_FOR_ETH,
  ERC20_FOR_ERC721,
  ERC20_FOR_ERC721_ANY,
}

export interface OrderParameters {
  offerer: string
  orderType: BasicOrderType
  offer: {
    itemType: ItemType
    tokenAddress?: string
    identifier?: number
    amount: bigint
  }
  consideration: {
    itemType: ItemType
    tokenAddress?: string
    identifier?: number
    amount: bigint
  }
  royaltyReceiver: string
  royaltyPercentageIn10000: number
  startTime: number
  endTime: number
  createdTime: number
}

export enum CollectionPageTabs {
  Overview,
  SalesActivity,
}

export enum UsersPageTabs {
  Overview,
  SalesActivity,
  Offers,
}
