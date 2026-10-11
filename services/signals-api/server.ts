/**
 * GrowTendril Signals — a small x402 seller, paywalled with Circle Gateway batching.
 *
 * It plays the role of an independent data vendor so the agent's purchase path is
 * exercised end-to-end on Arc mainnet: 402 → EIP-712 signature → Circle facilitator
 * settles → Gateway batches on-chain. Pattern from the-canteen-dev/circle-agent.
 *
 * Real entities are enriched from public APIs (GitHub, HN Algolia) at request time.
 */
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { formatUnits } from "viem";

const PORT = Number(process.env.SIGNALS_API_PORT || 4021);
const SELLER = process.env.SIGNALS_SELLER_ADDRESS;
const FACILITATOR = process.env.GATEWAY_API_URL || "https://gateway-api.circle.com";
const UA = "GrowTendril-Signals/0.1";

const app = express();

const PRICES = { company: "$0.01", creator: "$0.02", narrative: "$0.005" };

app.get("/", (_req, res) =>
  res.json({
    name: "GrowTendril Signals",
    paywall: SELLER ? "Circle Gateway x402 (Arc Mainnet)" : "DISABLED — set SIGNALS_SELLER_ADDRESS",
    seller: SELLER ?? null,
    network: "eip155:5042",
    endpoints: [
      { path: "/v1/company-intel?company=<name>&github=<org>", price: PRICES.company },
      { path: "/v1/creator-audience?handle=<handle>", price: PRICES.creator },
      { path: "/v1/narrative-pulse?term=<term>", price: PRICES.narrative },
    ],
  }),
);

type Paid = express.Request & { payment?: { payer: string; amount: string; network: string; transaction?: string } };

const gateway = SELLER ? createGatewayMiddleware({ sellerAddress: SELLER, facilitatorUrl: FACILITATOR, networks: ["eip155:5042"], description: "GrowTendril Signals data" }) : null;
const paywall = (price: string): express.RequestHandler =>
  gateway
    ? (gateway.require(price) as unknown as express.RequestHandler)
    : (_req, res) => res.status(503).json({ error: "Paywall not configured: set SIGNALS_SELLER_ADDRESS to an Arc mainnet address" });

const receipt = (req: Paid) => ({ paidBy: req.payment?.payer, amountUsdc: req.payment ? formatUnits(BigInt(req.payment.amount), 6) : null, network: req.payment?.network, settlementId: req.payment?.transaction ?? null });

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(8000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

app.get("/v1/company-intel", paywall(PRICES.company), async (req: Paid, res) => {
  const company = String(req.query.company ?? "").trim();
  if (!company) return res.status(400).json({ error: "company is required" });

  const signals: { signalType: string; summary: string; sourceUrl: string; observedAt: string; confidence: number }[] = [];
  const org = String(req.query.github ?? company).replace(/\s+/g, "");
  const gh = { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const orgInfo = await json<{ html_url: string; public_repos: number; created_at: string; blog?: string }>(`https://api.github.com/orgs/${encodeURIComponent(org)}`, gh);
  if (orgInfo) {
    const repos = (await json<{ name: string; html_url: string; pushed_at: string; description: string | null }[]>(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=5`, gh)) ?? [];
    for (const r of repos.filter((r) => Date.now() - new Date(r.pushed_at).getTime() < 14 * 86_400_000)) {
      signals.push({ signalType: "tech_adoption", summary: `Active repo ${r.name}: ${r.description ?? ""}`.trim(), sourceUrl: r.html_url, observedAt: r.pushed_at, confidence: 0.6 });
    }
  }
  const since = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
  const hn = await json<{ hits: { objectID: string; title: string | null; created_at: string }[] }>(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${company}"`)}&tags=story&numericFilters=created_at_i>${since}`);
  for (const h of hn?.hits ?? []) {
    const t = h.title ?? "";
    const type = /raise|series|seed|funding/i.test(t) ? "funding" : /hiring|jobs/i.test(t) ? "hiring" : /launch|show hn|introducing/i.test(t) ? "launch" : null;
    if (type) signals.push({ signalType: type, summary: t, sourceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`, observedAt: h.created_at, confidence: 0.7 });
  }
  res.json({ company, dataMode: "LIVE", signals, sources: ["api.github.com", "hn.algolia.com"], payment: receipt(req) });
});

app.get("/v1/creator-audience", paywall(PRICES.creator), async (req: Paid, res) => {
  const handle = String(req.query.handle ?? "").trim();
  if (!handle) return res.status(400).json({ error: "handle is required" });
  // No legitimate public source exposes follower demographics; say so instead of inventing them.
  res.json({ handle, dataMode: "LIVE", available: false, reason: "No permitted public source for audience composition of this creator", payment: receipt(req) });
});

app.get("/v1/narrative-pulse", paywall(PRICES.narrative), async (req: Paid, res) => {
  const term = String(req.query.term ?? "").trim();
  if (!term) return res.status(400).json({ error: "term is required" });
  const weeks: { weekStart: string; stories: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const from = Math.floor((Date.now() - (w + 1) * 7 * 86_400_000) / 1000);
    const to = Math.floor((Date.now() - w * 7 * 86_400_000) / 1000);
    const r = await json<{ nbHits: number }>(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${from},created_at_i<=${to}&hitsPerPage=0`);
    weeks.push({ weekStart: new Date(from * 1000).toISOString().slice(0, 10), stories: r?.nbHits ?? 0 });
  }
  res.json({ term, dataMode: "LIVE", source: "hn.algolia.com", weeks, payment: receipt(req) });
});

app.listen(PORT, () => {
  console.log(`GrowTendril Signals listening on http://localhost:${PORT}`);
  console.log(SELLER ? `x402 paywall active — seller ${SELLER} on Arc mainnet` : "x402 paywall DISABLED — set SIGNALS_SELLER_ADDRESS");
});
