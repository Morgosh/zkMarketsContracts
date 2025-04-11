import { abstractTestnet, abstract } from "viem/chains";

/**
 * This exports the chain configuration to be used in the application.
 * Uses Abstract testnet in development and the mainnet in production.
 * In this simple example, we use the testnet in both environments.
 */
  const activeChain = import.meta.env.VITE_NETWORK === "testnet" ? abstractTestnet : abstract;

export type SupportedChain = typeof activeChain;

export default activeChain;
