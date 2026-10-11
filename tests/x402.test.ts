import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { quote, pay } from "../src/server/integrations/circle/x402";
import { ARC } from "../src/server/integrations/circle/config";
import type { AgentSigner } from "../src/server/integrations/circle/signer";

// The seller is an in-process transport stub; no sockets or payment providers are used.
const transport = vi.hoisted(() => ({ redirect: false, requests: 0, price: "10000", lastRecovered: null as string | null }));
vi.mock("@/server/security/public-http", async (original) => {
  const real = await original<typeof import("@/server/security/public-http")>();
  return { ...real, getPublicText: async (value: string, opts: { method?: string; headers?: Record<string, string>; body?: string; redirect?: string }) => {
    transport.requests++;
    if (transport.redirect) {
      expect(opts.redirect).toBe("error");
      throw new Error("Website redirect is not allowed for this request");
    }
    return mockSeller(value, opts.headers?.["Payment-Signature"]);
  } };
});

/**
 * Offline x402 round-trip against a mock seller that speaks the same wire format as
 * Circle's createGatewayMiddleware (PAYMENT-REQUIRED / Payment-Signature / PAYMENT-RESPONSE).
 * The buyer signs with Circle's BatchEvmScheme; the mock recovers the EIP-712 signer.
 */
const SELLER = "0x933a2405f84c224be1ef373ba16e992e1f459682";
const base = "https://seller.example.test";

async function mockSeller(url: string, sig?: string) {
    const response = (status: number, text: string, headers: Record<string, string>) => ({ url, status, ok: status >= 200 && status < 300, text, contentType: "application/json", headers });
    const requirement = { scheme: "exact", network: ARC.caip2, asset: ARC.usdc, amount: transport.price, payTo: SELLER, maxTimeoutSeconds: 345600, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC.gatewayWallet } };
    if (!sig) {
      const pr = { x402Version: 2, resource: { url, description: "test data", mimeType: "application/json" }, accepts: [requirement] };
      return response(402, "{}", { "payment-required": Buffer.from(JSON.stringify(pr)).toString("base64") });
    }
    const payload = JSON.parse(Buffer.from(sig, "base64").toString()) as { payload: { signature: Hex; authorization: { from: Hex; to: Hex; value: string; validAfter: string; validBefore: string; nonce: Hex } } };
    const a = payload.payload.authorization;
    transport.lastRecovered = await recoverTypedDataAddress({
      domain: { name: "GatewayWalletBatched", version: "1", chainId: ARC.chainId, verifyingContract: ARC.gatewayWallet as Hex },
      types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ] },
      primaryType: "TransferWithAuthorization",
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
      signature: payload.payload.signature,
    });
    const settle = { success: true, transaction: "11111111-2222-3333-4444-555555555555", network: ARC.caip2, payer: a.from };
    return response(200, JSON.stringify({ ok: true, to: a.to, value: a.value }), { "payment-response": Buffer.from(JSON.stringify(settle)).toString("base64") });
}

function testSigner(): AgentSigner {
  const acct = privateKeyToAccount(generatePrivateKey());
  return { address: acct.address, kind: "circle_dcw", signTypedData: (p) => acct.signTypedData(p as Parameters<typeof acct.signTypedData>[0]) };
}

describe("x402 buyer (quote → policy → pay)", () => {
  it("parses the seller's 402 quote", async () => {
    const q = await quote(`${base}/v1/company-intel?company=Acme`);
    expect(q.kind).toBe("quote");
    if (q.kind !== "quote") return;
    expect(q.quote.amountMicro).toBe(10_000);
    expect(q.quote.payTo.toLowerCase()).toBe(SELLER);
  });

  it("signs a TransferWithAuthorization the seller can recover, and returns the settlement id", async () => {
    const signer = testSigner();
    const q = await quote(`${base}/x`);
    if (q.kind !== "quote") throw new Error("no quote");
    const r = await pay(q.quote, signer, { maxAmountMicro: 10_000 });
    expect(r.settlementId).toBe("11111111-2222-3333-4444-555555555555");
    expect(transport.lastRecovered?.toLowerCase()).toBe(signer.address.toLowerCase());
    expect((r.data as { to: string }).to.toLowerCase()).toBe(SELLER);
  });

  it("refuses to pay more than was authorized", async () => {
    transport.price = "50000";
    const q = await quote(`${base}/x`);
    if (q.kind !== "quote") throw new Error("no quote");
    await expect(pay(q.quote, testSigner(), { maxAmountMicro: 10_000 })).rejects.toThrow(/exceeds/);
    transport.price = "10000";
  });

  it("blocks loopback and insecure sellers before connecting", async () => {
    const before = transport.requests;
    expect((await quote("https://127.0.0.1/private")).kind).toBe("unsupported");
    expect((await quote("http://seller.example.test/x")).kind).toBe("unsupported");
    expect((await quote("http://127.0.0.1:3000/private")).kind).toBe("unsupported");
    expect(transport.requests).toBe(before);
  });

  it("rejects redirects during quotes and signed requests", async () => {
    const q = await quote(`${base}/x`);
    if (q.kind !== "quote") throw new Error("no quote");
    transport.redirect = true;
    try {
      await expect(quote(`${base}/x`)).rejects.toThrow(/redirect/);
      await expect(pay(q.quote, testSigner(), { maxAmountMicro: 10_000 })).rejects.toThrow(/redirect/);
    } finally { transport.redirect = false; }
  });
});
