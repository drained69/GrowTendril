import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet, sepolia, type Chain } from "viem/chains";
import { networkSetting } from "@/server/integrations/circle/network-env";

/**
 * One switch for the whole deployment: GROWTENDRIL_NETWORK=testnet (default) | mainnet.
 * Every chain id, token/contract address, Gateway endpoint and explorer comes from Circle's
 * own SDK (CHAIN_CONFIGS in @circle-fin/x402-batching) or viem's chain registry - nothing is
 * hand-copied. App Kit and Circle Wallets identifiers match the enums in their published types.
 */
export type NetworkName = "testnet" | "mainnet";

export function networkName(): NetworkName {
  const v = networkSetting();
  if (v !== "testnet" && v !== "mainnet") throw new Error(`GROWTENDRIL_NETWORK must be "testnet" or "mainnet" (got "${v}")`);
  return v;
}

export const IS_MAINNET = networkName() === "mainnet";

const arc = IS_MAINNET ? CHAIN_CONFIGS.arc : CHAIN_CONFIGS.arcTestnet;
const explorerOf = (c: Chain) => c.blockExplorers?.default.url ?? "";

export const ARC = {
  name: IS_MAINNET ? "Arc" : "Arc Testnet",
  network: networkName(),
  /** Provenance label for money that moves on this network. */
  dataMode: (IS_MAINNET ? "LIVE" : "TESTNET") as "LIVE" | "TESTNET",
  chainId: arc.chain.id,
  caip2: `eip155:${arc.chain.id}`,
  x402Chain: (IS_MAINNET ? "arc" : "arcTestnet") as "arc" | "arcTestnet",
  gatewayDomain: arc.domain,
  usdc: arc.usdc,
  gatewayWallet: arc.gatewayWallet,
  gatewayMinter: arc.gatewayMinter,
  rpcUrl: process.env.ARC_RPC_URL ?? (IS_MAINNET ? undefined : process.env.ARC_TESTNET_RPC) ?? arc.rpcUrl ?? arc.chain.rpcUrls.default.http[0],
  explorer: explorerOf(arc.chain),
  appKitChain: (IS_MAINNET ? "Arc" : "Arc_Testnet") as AppKitChain,
  circleBlockchain: (IS_MAINNET ? "ARC" : "ARC-TESTNET") as "ARC" | "ARC-TESTNET",
  faucet: IS_MAINNET ? null : "https://faucet.circle.com",
};

export const GATEWAY_API = process.env.GATEWAY_API_URL ?? (IS_MAINNET ? "https://gateway-api.circle.com" : "https://gateway-api-testnet.circle.com");
export const DISCOVERY_API = process.env.CIRCLE_DISCOVERY_URL ?? "https://api.circle.com/v2/x402/discovery/resources";

/** App Kit chain identifiers GrowTendril may use, by network. */
export const TESTNET_CHAINS = ["Arc_Testnet", "Base_Sepolia", "Arbitrum_Sepolia", "Ethereum_Sepolia"] as const;
export const MAINNET_CHAINS = ["Arc", "Base", "Arbitrum", "Ethereum"] as const;
export type AppKitChain = (typeof TESTNET_CHAINS)[number] | (typeof MAINNET_CHAINS)[number];
export const ACTIVE_CHAINS: readonly AppKitChain[] = IS_MAINNET ? MAINNET_CHAINS : TESTNET_CHAINS;
/** The usual second chain for bridged budget (Base on either network). */
export const BRIDGE_CHAIN: AppKitChain = IS_MAINNET ? "Base" : "Base_Sepolia";

type ChainInfo = { label: string; circle: string; explorer: string; caip2: string; rpc: string; mainnet: boolean };
const info = (label: string, circle: string, c: Chain, isMain: boolean, rpc?: string): ChainInfo => ({ label, circle, explorer: explorerOf(c), caip2: `eip155:${c.id}`, rpc: rpc ?? c.rpcUrls.default.http[0], mainnet: isMain });

/** App Kit chain id → Circle Wallets blockchain id → explorer/RPC, for both networks. */
export const CHAINS: Record<AppKitChain, ChainInfo> = {
  Arc_Testnet: { ...info("Arc Testnet", "ARC-TESTNET", CHAIN_CONFIGS.arcTestnet.chain, false), rpc: IS_MAINNET ? CHAIN_CONFIGS.arcTestnet.rpcUrl ?? "" : ARC.rpcUrl },
  Base_Sepolia: info("Base Sepolia", "BASE-SEPOLIA", baseSepolia, false),
  Arbitrum_Sepolia: info("Arbitrum Sepolia", "ARB-SEPOLIA", arbitrumSepolia, false),
  Ethereum_Sepolia: info("Ethereum Sepolia", "ETH-SEPOLIA", sepolia, false),
  Arc: { ...info("Arc", "ARC", CHAIN_CONFIGS.arc.chain, true), rpc: IS_MAINNET ? ARC.rpcUrl : CHAIN_CONFIGS.arc.rpcUrl ?? "" },
  Base: info("Base", "BASE", base, true),
  Arbitrum: info("Arbitrum", "ARB", arbitrum, true),
  Ethereum: info("Ethereum", "ETH", mainnet, true),
};

export const chainLabel = (chain: string) => CHAINS[chain as AppKitChain]?.label ?? chain;
export const txExplorerUrl = (chain: string, hash: string) => `${CHAINS[chain as AppKitChain]?.explorer ?? ARC.explorer}/tx/${hash}`;
export const addressExplorerUrl = (chain: string, addr: string) => `${CHAINS[chain as AppKitChain]?.explorer ?? ARC.explorer}/address/${addr}`;

export type WalletProvider = "circle_dcw" | "local_testnet" | "unconfigured";

/**
 * What this deployment can provision for a workspace:
 *  - circle: Circle developer-controlled wallets. Keys live in Circle's custody; GrowTendril holds only
 *    the API key + entity secret, server-side. Each workspace gets its own EOA on Arc.
 *  - local: a single server-side key from AGENT_PRIVATE_KEY. Development only and testnet only:
 *    refused on mainnet. Never sent to the browser or the LLM.
 */
export function platformCustody(): "circle" | "local" | null {
  if (process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET) return custodyProblem() ? null : "circle";
  if (process.env.AGENT_PRIVATE_KEY && !IS_MAINNET) return "local";
  return null;
}

/** Circle API keys say which environment they belong to: TEST_API_KEY:… (testnets) or LIVE_API_KEY:… (mainnets). */
export function circleKeyEnvironment(key = process.env.CIRCLE_API_KEY): "test" | "live" | "unknown" | null {
  if (!key) return null;
  if (key.startsWith("TEST_API_KEY:")) return "test";
  if (key.startsWith("LIVE_API_KEY:")) return "live";
  return "unknown";
}

/**
 * Why the configured Circle credentials can't be used on this network, or null when they can.
 * A TEST key can only create testnet wallets and a LIVE key only mainnet ones, so a mismatch would
 * fail at the first Circle call; it is refused up front with a message that says what to change.
 */
export function custodyProblem(): string | null {
  const env = circleKeyEnvironment();
  if (!env || !process.env.CIRCLE_ENTITY_SECRET) return null;
  if (IS_MAINNET && env === "test") return "CIRCLE_API_KEY is a TEST key but GROWTENDRIL_NETWORK=mainnet. Create a LIVE API key in console.circle.com and register an entity secret for it (npm run wallet:setup -- --entity-secret).";
  if (!IS_MAINNET && env === "live") return "CIRCLE_API_KEY is a LIVE key but the network is testnet. Set GROWTENDRIL_NETWORK=mainnet, or use a TEST key.";
  return null;
}

/** Public, non-secret network facts the UI may show. */
export function networkInfo() {
  return { name: ARC.name, network: ARC.network, mainnet: IS_MAINNET, explorer: ARC.explorer, faucet: ARC.faucet, chainId: ARC.chainId, dataMode: ARC.dataMode };
}
