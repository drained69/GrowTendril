import type { Address, Hex } from "viem";
import { circleClient } from "@/server/integrations/circle/client";
import { ARC, platformCustody } from "@/server/integrations/circle/config";

/** Shape required by Circle's BatchEvmScheme (x402-batching). */
export interface AgentSigner {
  address: Address;
  kind: "circle_dcw";
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
  blockchain?: string;
  dataMode?: string;
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

/** The workspace wallet's signer, or null if it cannot sign. Never exposes key material. */
export function signerFor(w: SignableWallet | null | undefined): AgentSigner | null {
  if (!w) return null;
  if (w.provider === "circle_dcw" && w.blockchain === ARC.circleBlockchain && w.dataMode === "LIVE" && w.circleWalletId && w.address && platformCustody() === "circle") return circleSigner(w.circleWalletId, w.address);
  return null;
}
