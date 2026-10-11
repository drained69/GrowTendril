import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { ARC } from "@/server/integrations/circle/config";
import type { AgentSigner } from "@/server/integrations/circle/signer";
import { getPublicText, publicUrl } from "@/server/security/public-http";

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
  try {
    if (publicUrl(url).protocol !== "https:") return { kind: "unsupported", reason: "Seller must use HTTPS" };
  } catch (e) { return { kind: "unsupported", reason: (e as Error).message }; }
  const method = opts.method ?? "GET";
  const res = await getPublicText(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    timeoutMs: 15_000,
    maxBytes: 1_000_000,
    redirect: "error",
  });
  if (res.status !== 402) {
    if (res.ok) return { kind: "free", status: res.status, data: jsonOrNull(res.text) };
    return { kind: "unsupported", reason: `HTTP ${res.status}` };
  }
  const header = res.headers["payment-required"];
  if (!header) return { kind: "unsupported", reason: "402 without PAYMENT-REQUIRED header" };
  const pr = jsonOrNull(Buffer.from(header, "base64").toString("utf-8")) as { x402Version?: number; resource?: { description?: string }; accepts?: PaymentRequirement[] } | null;
  const option = Array.isArray(pr?.accepts) ? pr.accepts.find((o) => o && o.scheme === "exact" && o.network === ARC.caip2 && o.extra?.name === "GatewayWalletBatched" && o.extra?.version === "1" && typeof o.extra?.verifyingContract === "string") : undefined;
  if (!option) return { kind: "unsupported", reason: `No Circle Gateway batching option on ${ARC.caip2}` };
  if (typeof option.asset !== "string" || option.asset.toLowerCase() !== ARC.usdc.toLowerCase() || String(option.extra?.verifyingContract).toLowerCase() !== ARC.gatewayWallet.toLowerCase()) return { kind: "unsupported", reason: "Seller requested an unexpected asset or Gateway contract" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(option.payTo) || /^0x0{40}$/i.test(option.payTo) || !/^\d+$/.test(option.amount) || !Number.isSafeInteger(Number(option.amount)) || Number(option.amount) <= 0 || !Number.isSafeInteger(option.maxTimeoutSeconds) || option.maxTimeoutSeconds <= 0) return { kind: "unsupported", reason: "Invalid seller address or price" };
  return {
    kind: "quote",
    quote: {
      url,
      method,
      x402Version: pr!.x402Version ?? 2,
      resource: pr!.resource,
      requirement: option,
      amountMicro: Number(option.amount),
      payTo: option.payTo,
      description: pr!.resource?.description,
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
  if (publicUrl(q.url).protocol !== "https:") throw new Error("Seller must use HTTPS");
  if (q.requirement.network !== ARC.caip2 || q.requirement.asset.toLowerCase() !== ARC.usdc.toLowerCase() || q.requirement.extra?.verifyingContract?.toString().toLowerCase() !== ARC.gatewayWallet.toLowerCase()) throw new Error("Payment terms are not Arc mainnet USDC Gateway terms");
  if (q.amountMicro > opts.maxAmountMicro) throw new Error(`Quoted ${q.amountMicro} exceeds authorized ${opts.maxAmountMicro}`);
  if (!Number.isSafeInteger(opts.maxAmountMicro) || opts.maxAmountMicro <= 0 || !Number.isSafeInteger(q.amountMicro) || q.amountMicro <= 0 || !/^\d+$/.test(q.requirement.amount) || Number(q.requirement.amount) !== q.amountMicro || q.requirement.payTo.toLowerCase() !== q.payTo.toLowerCase()) throw new Error("Quoted payment amount or recipient is inconsistent");
  const scheme = new BatchEvmScheme({ address: signer.address, signTypedData: (p) => signer.signTypedData(p) });
  scheme.onBeforePaymentCreation(async (ctx) => {
    if (BigInt(ctx.selectedRequirements.amount) > BigInt(opts.maxAmountMicro)) return { abort: true, reason: "Amount exceeds GrowTendril authorization" };
  });
  const payload = await scheme.createPaymentPayload(q.x402Version, q.requirement);
  const header = Buffer.from(JSON.stringify({ ...payload, resource: q.resource, accepted: q.requirement })).toString("base64");
  const res = await getPublicText(q.url, {
    method: q.method,
    headers: { "Content-Type": "application/json", "Payment-Signature": header },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    timeoutMs: 30_000,
    maxBytes: 1_000_000,
    redirect: "error",
  });
  const pr = res.headers["payment-response"];
  const settle = pr ? (jsonOrNull(Buffer.from(pr, "base64").toString("utf-8")) as { transaction?: string; network?: string; payer?: string; success?: boolean } | null) : undefined;
  if (!res.ok) {
    const err = (jsonOrNull(res.text) ?? {}) as { error?: string; reason?: string };
    throw new Error(`Payment failed (${res.status}): ${err.error ?? "seller error"}${err.reason ? ` — ${err.reason}` : ""}`);
  }
  if (!settle?.transaction || settle.success === false || settle.network !== ARC.caip2 || settle.payer?.toLowerCase() !== signer.address.toLowerCase()) throw new Error("Seller returned an invalid Arc settlement receipt");
  return { status: res.status, data: jsonOrNull(res.text), settlementId: settle.transaction, network: settle.network ?? q.requirement.network, payer: settle.payer ?? signer.address, amountMicro: q.amountMicro };
}

const jsonOrNull = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };
