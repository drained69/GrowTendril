import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { ARC } from "@/server/integrations/circle/config";
import type { AgentSigner } from "@/server/integrations/circle/signer";

/**
 * x402 buyer over Circle Gateway batching — mirrors GatewayClient.pay() from
 * @circle-fin/x402-batching, split into two phases so policy runs on the *quoted* price:
 *
 *   1. quote(url)  — unpaid request → 402 + PAYMENT-REQUIRED header → the seller's exact terms
 *   2. pay(quote)  — sign a TransferWithAuthorization (EIP-712) via BatchEvmScheme, retry the
 *                    request with Payment-Signature, read PAYMENT-RESPONSE → settlement id
 *
 * The scheme's onBeforePaymentCreation hook enforces an absolute amount cap, so a seller that
 * changes its price between quote and payment cannot be paid more than was authorized.
 */

export interface PaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  amount: string; // atomic units (6 decimals)
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402Quote {
  url: string;
  method: "GET" | "POST";
  x402Version: number;
  resource: unknown;
  requirement: PaymentRequirement;
  amountMicro: number;
  payTo: string;
  description?: string;
}

export type QuoteResult = { kind: "quote"; quote: X402Quote } | { kind: "free"; status: number; data: unknown } | { kind: "unsupported"; reason: string };

export async function quote(url: string, opts: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<QuoteResult> {
  const method = opts.method ?? "GET";
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 402) {
    if (res.ok) return { kind: "free", status: res.status, data: await res.json().catch(() => null) };
    return { kind: "unsupported", reason: `HTTP ${res.status}` };
  }
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) return { kind: "unsupported", reason: "402 without PAYMENT-REQUIRED header" };
  const pr = JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as { x402Version?: number; resource?: { description?: string }; accepts?: PaymentRequirement[] };
  const option = pr.accepts?.find((o) => o.network === ARC.caip2 && o.extra?.name === "GatewayWalletBatched" && o.extra?.version === "1" && typeof o.extra?.verifyingContract === "string");
  if (!option) return { kind: "unsupported", reason: `No Circle Gateway batching option on ${ARC.caip2}` };
  return {
    kind: "quote",
    quote: {
      url,
      method,
      x402Version: pr.x402Version ?? 2,
      resource: pr.resource,
      requirement: option,
      amountMicro: Number(option.amount),
      payTo: option.payTo,
      description: pr.resource?.description,
    },
  };
}

export interface PayResult {
  status: number;
  data: unknown;
  settlementId: string;
  network: string;
  payer: string;
  amountMicro: number;
}

export async function pay(q: X402Quote, signer: AgentSigner, opts: { maxAmountMicro: number; body?: unknown }): Promise<PayResult> {
  if (q.amountMicro > opts.maxAmountMicro) throw new Error(`Quoted ${q.amountMicro} exceeds authorized ${opts.maxAmountMicro}`);
  const scheme = new BatchEvmScheme({ address: signer.address, signTypedData: (p) => signer.signTypedData(p) });
  scheme.onBeforePaymentCreation(async (ctx) => {
    if (BigInt(ctx.selectedRequirements.amount) > BigInt(opts.maxAmountMicro)) return { abort: true, reason: "Amount exceeds GrowTendril authorization" };
  });
  const payload = await scheme.createPaymentPayload(q.x402Version, q.requirement);
  const header = Buffer.from(JSON.stringify({ ...payload, resource: q.resource, accepted: q.requirement })).toString("base64");
  const res = await fetch(q.url, {
    method: q.method,
    headers: { "Content-Type": "application/json", "Payment-Signature": header },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const pr = res.headers.get("PAYMENT-RESPONSE");
  const settle = pr ? (JSON.parse(Buffer.from(pr, "base64").toString("utf-8")) as { transaction?: string; network?: string; payer?: string; success?: boolean }) : undefined;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    throw new Error(`Payment failed (${res.status}): ${err.error ?? res.statusText}${err.reason ? ` — ${err.reason}` : ""}`);
  }
  if (!settle?.transaction) throw new Error("Seller returned no settlement id (PAYMENT-RESPONSE missing)");
  return { status: res.status, data: await res.json(), settlementId: settle.transaction, network: settle.network ?? q.requirement.network, payer: settle.payer ?? signer.address, amountMicro: q.amountMicro };
}
