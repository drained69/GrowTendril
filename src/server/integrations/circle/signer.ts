import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleClient } from "@/server/integrations/circle/client";
import { IS_MAINNET } from "@/server/integrations/circle/config";

/** Shape required by Circle's BatchEvmScheme (x402-batching). */
export interface AgentSigner {
  address: Address;
  kind: "circle_dcw" | "local_testnet";
  signTypedData(params: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export interface SignableWallet {
  provider: string;
  address: string | null;
  circleWalletId: string | null;
}

const jsonSafe = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonSafe) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)])) : v;

function circleSigner(walletId: string, address: string): AgentSigner {
  return {
    address: address as Address,
    kind: "circle_dcw",
    async signTypedData({ domain, types, primaryType, message }) {
      // Circle expects the full EIP-712 document, including the EIP712Domain type.
      const data = JSON.stringify(
        jsonSafe({
          types: {
            EIP712Domain: [
              { name: "name", type: "string" },
              { name: "version", type: "string" },
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
            ...types,
          },
          domain,
          primaryType,
          message,
        }),
      );
      const res = await (await circleClient()).signTypedData({ walletId, data, memo: "GrowTendril x402 payment authorization" });
      const sig = res.data?.signature;
      if (!sig) throw new Error("Circle signTypedData returned no signature");
      return sig as Hex;
    },
  };
}

export function localKeyAddress(): string | null {
  const pk = process.env.AGENT_PRIVATE_KEY;
  return pk ? privateKeyToAccount(pk as Hex).address : null;
}

function localSigner(): AgentSigner {
  const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);
  return { address: account.address, kind: "local_testnet", signTypedData: (p) => account.signTypedData(p as Parameters<typeof account.signTypedData>[0]) };
}

/** The workspace wallet's signer, or null if it cannot sign. Never exposes key material. */
export function signerFor(w: SignableWallet | null | undefined): AgentSigner | null {
  if (!w) return null;
  if (w.provider === "circle_dcw" && w.circleWalletId && w.address) return circleSigner(w.circleWalletId, w.address);
  if (w.provider === "local_testnet" && process.env.AGENT_PRIVATE_KEY && !IS_MAINNET) return localSigner();
  return null;
}
