import { ARC } from "@/server/integrations/circle/config";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { randomBytes } from "node:crypto";
import { newId, shortCode, sha256 } from "@/server/lib/ids";
import { toMicro } from "@/lib/money";
import { DAY_MS } from "@/lib/time";
import { DEFAULT_POLICY } from "@/server/domain/agent/policy";
import { ingestPosts } from "@/server/domain/intel/ingest";
import { analyzeProject } from "@/server/domain/intel/analyze";
import { createTransaction, transition } from "@/server/domain/agent/ledger";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { recordConversion } from "@/server/domain/growth/attribution";
import { registerBundledSignalsService } from "@/server/integrations/circle/marketplace";
import type { FetchedPost } from "@/server/integrations/providers/types";
import { hashPassword } from "@/server/auth/password";
import { utmSlug } from "@/server/domain/growth/attribution-links";

/**
 * DEMO MODE — a fictional AI-agent developer tool ("Meterline") on the mission
 * "First 100 Developers" with 500 test USDC. Every seeded post, company, creator and
 * conversion is fictional and stored with dataMode = DEMO; links point at /demo/source/*
 * pages that say so. The seeded corpus is fed through the *real* ingest + analysis engine.
 */

export const DEMO_EMAIL = "demo@growthos.dev";
export const DEMO_PASSWORD = "growthos-demo";

type P = { id: string; provider: string; handle: string; name?: string; followers?: number; company?: string; days: number; text: string; eng: FetchedPost["engagement"]; title?: string };

const GENERIC = (id: string, provider: string, handle: string, days: number, text: string, eng: FetchedPost["engagement"] = { likes: 20, comments: 4 }): P => ({ id, provider, handle, days, text, eng });

export const DEMO_POSTS: P[] = [
  // ── Customers ──
  { id: "acme-cto-x402", provider: "x", handle: "jordan_acme", name: "Jordan Lee (CTO, Acme Labs)", followers: 3100, company: "Acme Labs", days: 1, text: "Spent the weekend reading the x402 spec. If our AI agents could pay per call in USDC we'd drop three API subscriptions. Anyone running x402 in production?", eng: { likes: 140, comments: 38, shares: 12 } },
  { id: "acme-hn-initiative", provider: "hackernews", handle: "acmelabs", company: "Acme Labs", days: 6, title: "Acme Labs: our stablecoin payments initiative for agents", text: "We're building agent payments into the Acme agent platform — settlement in USDC, pay-per-call pricing for tools our agents use.", eng: { score: 88, comments: 41 } },
  { id: "northwind-gh-rec", provider: "github", handle: "northwind-agents", company: "Northwind Agents", days: 3, title: "northwind-agents/procure-bot: Payments for tool calls", text: "Looking for an SDK that lets our agents pay per call — any recommendations? Subscriptions don't fit bursty AI agents traffic. x402 looks promising.", eng: { comments: 17, likes: 22 } },
  { id: "northwind-hn", provider: "hackernews", handle: "nw_founder", company: "Northwind Agents", days: 2, text: "Northwind Agents is exploring x402 so our procurement agents can buy data per request instead of holding API keys.", eng: { score: 34, comments: 12 } },
  { id: "kestrel-reddit", provider: "reddit", handle: "kestrel_eng", company: "Kestrel Pay", days: 9, title: "r/fintech: metered billing for agents", text: "We're using MeterStack for metered billing but AI agents can't hold cards. Frustrating. Is pay-per-call with stablecoin APIs viable yet?", eng: { score: 45, comments: 19 } },

  // ── KOL: ada_ships — technical, high discussion, has covered competitor PayGate, not us ──
  { id: "ada-yt-1", provider: "youtube", handle: "ada_ships", name: "Ada Ships", followers: 82000, days: 1, title: "x402 in 12 minutes: agents that pay for their own API calls", text: "x402 in 12 minutes: building AI agents that pay for their own API calls with USDC. Agent payments without API keys.", eng: { views: 41000, likes: 2400, comments: 310 } },
  { id: "ada-yt-2", provider: "youtube", handle: "ada_ships", name: "Ada Ships", followers: 82000, days: 3, title: "Agent payments: PayGate vs rolling your own", text: "Agent payments compared: PayGate vs rolling your own with x402 and stablecoin APIs. Which one should developers pick?", eng: { views: 28000, likes: 1700, comments: 240 } },
  { id: "ada-yt-3", provider: "youtube", handle: "ada_ships", name: "Ada Ships", followers: 82000, days: 5, title: "MCP tools that charge per call", text: "Wiring MCP tools so AI agents pay per call — pay-per-call pricing, agent payments and the x402 header flow explained for developers.", eng: { views: 19000, likes: 1100, comments: 160 } },
  { id: "ada-yt-old", provider: "youtube", handle: "ada_ships", name: "Ada Ships", followers: 82000, days: 20, text: "Shipping a TypeScript SDK the right way — lessons for developers.", eng: { views: 12000, likes: 600, comments: 70 } },

  // ── KOL: priya_builds — deep technical, already covered us (past campaign) ──
  { id: "priya-hn-1", provider: "hackernews", handle: "priya_builds", days: 2, title: "Deep dive: x402 + Circle Gateway batching for agent payments", text: "Deep dive: x402 + Circle Gateway batching for agent payments. How nanopayments settle on Arc and why developers should care.", eng: { score: 210, comments: 96 } },
  { id: "priya-hn-2", provider: "hackernews", handle: "priya_builds", days: 4, text: "I tried Meterline for pay-per-call APIs — it just works for x402, docs could show more agent payments examples.", eng: { score: 64, comments: 30 } },
  { id: "priya-gh-1", provider: "github", handle: "priya_builds", days: 6, title: "priya/x402-agent-examples", text: "priya/x402-agent-examples: AI agents paying per call with USDC — x402 examples for developers.", eng: { stars: 340, comments: 12 } },

  // ── KOL: marcus_onchain — huge follower count, low-quality engagement ──
  { id: "marcus-x-1", provider: "x", handle: "marcus_onchain", name: "Marcus", followers: 450000, days: 2, text: "Agent payments are the next 100x narrative 🚀 giveaway for 3 lucky followers, RT to enter. NFA.", eng: { likes: 900, comments: 12, shares: 300 } },
  { id: "marcus-x-2", provider: "x", handle: "marcus_onchain", name: "Marcus", followers: 450000, days: 4, text: "x402 coins about to moon. Agent payments season. Not financial advice.", eng: { likes: 700, comments: 9, shares: 200 } },
  { id: "marcus-x-3", provider: "x", handle: "marcus_onchain", name: "Marcus", followers: 450000, days: 11, text: "Presale alert: AI agents token. Agent payments will be huge.", eng: { likes: 1200, comments: 15, shares: 500 } },

  // ── Market conversation (narrative volume) ──
  GENERIC("g1", "x", "dev_kai", 1, "Agent payments are finally getting real — paying per tool call beats another monthly plan."),
  GENERIC("g2", "reddit", "lena_codes", 2, "Can anyone recommend a way for my agent to pay for API calls per request? Looking for an SDK, x402 maybe?", { score: 28, comments: 14 }),
  GENERIC("g3", "hackernews", "mtorres", 2, "Agent payments with stablecoin APIs: the missing piece for autonomous AI agents.", { score: 51, comments: 22 }),
  GENERIC("g4", "x", "sam_infra", 3, "Every agent payments demo I see this week uses x402. Interesting shift."),
  GENERIC("g5", "github", "openagents-dev", 3, "openagents/tools: add agent payments adapter (x402) for paid tools", { comments: 9, likes: 15 }),
  GENERIC("g6", "x", "nina_ai", 4, "Hot take: agent payments need pay-per-call pricing, not API keys."),
  GENERIC("g7", "reddit", "builder_bob", 5, "Agent payments idea: let AI agents buy data per request with USDC. Has anyone shipped this?", { score: 19, comments: 8 }),
  GENERIC("g8", "hackernews", "jk_dev", 6, "x402 is a clean way to do HTTP 402 payments for AI agents.", { score: 40, comments: 18 }),
  GENERIC("g9", "x", "rhea_eth", 6, "Stablecoin APIs + agent payments is the developer story of the quarter."),
  GENERIC("g10", "x", "tomasz_b", 9, "Agent payments still feel early, but the tooling is improving."),
  GENERIC("g11", "hackernews", "aria_n", 10, "Ask HN: how do you handle agent payments for API usage today?", { score: 22, comments: 30 }),
  GENERIC("g12", "reddit", "quant_qi", 11, "Agent payments without cards — are stablecoin APIs the answer?", { score: 12, comments: 6 }),
  GENERIC("g13", "x", "dev_kai", 12, "Thinking about agent payments for our scraper bots."),
  GENERIC("g14", "github", "mcp-hub", 13, "mcp-hub: discussion — agent payments for MCP servers", { comments: 11 }),
  GENERIC("g15", "x", "lou_web3", 1, "Cross-chain UX is still painful but fewer people are talking about it."),
  GENERIC("g16", "x", "lou_web3", 8, "Cross-chain UX is the biggest problem in crypto right now."),
  GENERIC("g17", "reddit", "chainhopper", 9, "Cross-chain UX rant: bridging is still confusing for normal users.", { score: 30, comments: 20 }),
  GENERIC("g18", "x", "vee_dev", 10, "Cross-chain UX needs chain abstraction, full stop."),
  GENERIC("g19", "hackernews", "oz_eng", 12, "Cross-chain UX: lessons from shipping a multichain wallet.", { score: 25, comments: 9 }),
  GENERIC("g20", "x", "vee_dev", 2, "Cross-chain UX improved a bit with unified balances."),

  // ── Product mentions of Meterline (incl. a growing onboarding issue) ──
  GENERIC("m1", "x", "builder_jo", 1, "Meterline wallet setup is confusing — stuck on connect wallet before I can call anything."),
  GENERIC("m2", "reddit", "agentsmith", 2, "Love the idea of Meterline but wallet onboarding is painful for first-time users.", { score: 14, comments: 7 }),
  GENERIC("m3", "github", "kd-labs", 3, "Meterline: onboarding fails at wallet creation on testnet (issue)", { comments: 5 }),
  GENERIC("m4", "x", "fran_codes", 5, "Meterline onboarding: connect wallet step is unclear, docs don't say which network."),
  GENERIC("m5", "x", "builder_jo", 9, "Tried Meterline, wallet setup took a while."),
  GENERIC("m6", "reddit", "agentsmith", 12, "Meterline onboarding was a bit painful, connect wallet flow is slow.", { score: 6, comments: 2 }),
  GENERIC("m7", "x", "ella_ships", 2, "Meterline just works — my agent paid for a lookup in 2 lines. Great DX."),
  GENERIC("m8", "x", "ken_ai", 4, "Would love Meterline support for Base — please add."),
  GENERIC("m9", "hackernews", "pd_eng", 3, "Meterline vs MeterStack: Meterline is easier for agent payments, pricing page is unclear though.", { score: 20, comments: 11 }),
];

export const DEMO_PROFILE = {
  summary: "Meterline is an SDK that lets AI agents pay for API calls per request in USDC using x402 — no subscriptions or API keys. Settlement runs through Circle Gateway on Arc.",
  category: "AI agent infrastructure · Stablecoin payments",
  targetUsers: ["AI agent developers", "API providers", "Web3 infrastructure teams"],
  competitors: ["PayGate", "MeterStack"],
  valueProps: ["Agents pay per call — no subscriptions or API keys", "USDC settlement on Arc via Circle Gateway", "Drop-in middleware for Express and Next.js"],
  integrations: ["Arc", "Circle Gateway", "Express", "Next.js", "MCP"],
  useCases: ["An agent buys a single data lookup for $0.01", "MCP tools that charge per call", "Usage-based APIs without key management"],
  pricing: "Free SDK; 0.5% of settled volume (DEMO)",
  terminology: ["x402", "agent payments", "pay-per-call", "nanopayments", "stablecoin APIs", "MCP", "USDC"],
  keywords: ["x402", "agent payments", "pay-per-call", "stablecoin APIs", "AI agents"],
};

export async function ensureDemoUser(db: DB): Promise<string> {
  const [u] = await db.select().from(s.users).where(eq(s.users.email, DEMO_EMAIL));
  if (u) return u.id;
  const [n] = await db.insert(s.users).values({ id: newId(), email: DEMO_EMAIL, name: "Demo Founder", passwordHash: hashPassword(DEMO_PASSWORD) }).returning();
  return n.id;
}

/**
 * Creates a demo workspace owned by `ownerId` (default: the shared demo account used by scripts).
 * With `reset`, the owner's existing demo workspaces are removed first. Returns the new project id.
 */
export async function seedDemo(db: DB, opts: { reset?: boolean; ownerId?: string } = {}): Promise<string> {
  const userId = opts.ownerId ?? (await ensureDemoUser(db));
  const existing = await db.select().from(s.projects).where(and(eq(s.projects.ownerId, userId), eq(s.projects.dataMode, "DEMO")));
  if (existing.length && !opts.reset) return existing[0].id;
  for (const p of existing) await db.delete(s.projects).where(eq(s.projects.id, p.id));

  const now = Date.now();
  const projectId = newId();
  await db.insert(s.projects).values({
    id: projectId,
    ownerId: userId,
    name: "Meterline",
    website: "https://meterline.example",
    docsUrl: "https://meterline.example/docs",
    xHandle: "meterline",
    githubUrl: "https://github.com/meterline-demo/sdk",
    description: DEMO_PROFILE.summary,
    // Random, like live workspaces: a secret derived from the (visible) project ID would let anyone sign events.
    webhookSecret: randomBytes(32).toString("hex"),
    onboardingStep: 5,
    dataMode: "DEMO",
  });
  await db.insert(s.memberships).values({ id: newId(), projectId, userId, role: "owner" });
  await db.insert(s.productProfiles).values({ id: newId(), projectId, ...DEMO_PROFILE, crawledSources: [{ url: "https://meterline.example", ok: false, note: "DEMO profile — not crawled" }], generatedBy: "demo" });
  await db.insert(s.icps).values([
    { id: newId(), projectId, tier: "primary", title: "AI agent developers", description: "Teams shipping agents that call paid APIs or move money", companySize: "2–50", segments: ["ai agents", "developers", "agent developers"], signals: ["Asks how agents pay for APIs", "Building with MCP / tool use", "Mentions x402"] },
    { id: newId(), projectId, tier: "secondary", title: "Web3 infrastructure teams", description: "10–100 person teams building developer-facing products on stablecoin rails", companySize: "10–100", segments: ["infrastructure", "web3 developers", "stablecoin"], signals: ["Stablecoin initiative announced", "Hiring smart contract engineers"] },
    { id: newId(), projectId, tier: "secondary", title: "Developer tooling companies", description: "API businesses exploring usage-based machine payments", companySize: "10–200", segments: ["developer tools", "api providers"], signals: ["Discussing usage-based pricing"] },
  ]);
  const missionId = newId();
  await db.insert(s.missions).values({
    id: missionId,
    projectId,
    template: "first_100_devs",
    name: "First 100 Developers",
    goalDescription: "100 qualified developers who create an SDK key",
    goalEvent: "sdk_key_created",
    goalTarget: 100,
    budgetMicro: toMicro(500),
    startsAt: new Date(now - 6 * DAY_MS),
    endsAt: new Date(now + 8 * DAY_MS),
    status: "active",
    dataMode: "DEMO",
  });
  const alloc: Record<string, number> = { research: 20, services: 15, kol: 325, bounty: 40, content: 100 };
  await db.insert(s.missionBudgets).values(Object.entries(alloc).map(([category, v]) => ({ id: newId(), missionId, category, allocatedMicro: toMicro(v) })));
  await db.insert(s.policies).values({ id: newId(), projectId, ...DEFAULT_POLICY });
  await db.insert(s.wallets).values({ id: newId(), projectId, provider: "unconfigured", blockchain: ARC.circleBlockchain, status: "SIMULATION", dataMode: "DEMO" });

  // Feed the fictional corpus through the real pipeline.
  const byProvider = new Map<string, FetchedPost[]>();
  for (const p of DEMO_POSTS) {
    const fp: FetchedPost = {
      externalId: `demo-${p.id}`,
      url: `/demo/source/${p.id}`,
      authorHandle: p.handle,
      authorName: p.name,
      authorUrl: `/demo/source/${p.id}`,
      authorFollowers: p.followers,
      title: p.title,
      companyHint: p.company,
      content: p.text,
      publishedAt: new Date(now - p.days * DAY_MS - 3_600_000),
      engagement: p.eng,
    };
    byProvider.set(p.provider, [...(byProvider.get(p.provider) ?? []), fp]);
  }
  for (const [provider, posts] of byProvider) await ingestPosts(db, projectId, provider, posts, "DEMO", { keywords: [...DEMO_PROFILE.keywords, ...DEMO_PROFILE.terminology] });
  await analyzeProject(db, projectId, () => {}, now);
  await registerBundledSignalsService(db);

  // History: three experiments that ran earlier in the mission, with simulated spend and
  // fictional conversions. This gives the learning engine measured inputs to act on.
  const kolByHandle = async (h: string) => (await db.select().from(s.kols).where(and(eq(s.kols.projectId, projectId), eq(s.kols.handle, h))))[0];
  const history = [
    { n: 1, title: "Creator campaign — @marcus_onchain", channel: "kol", cat: "kol", kol: "marcus_onchain", budget: 175, spent: 150, conv: 4, visits: 31, started: 6, hypothesis: "A large-audience creator post about agent payments will drive SDK signups." },
    { n: 2, title: "Creator campaign — @priya_builds", channel: "kol", cat: "kol", kol: "priya_builds", budget: 120, spent: 100, conv: 21, visits: 74, started: 5, hypothesis: "A deep technical write-up by an infra engineer will convert developers who already understand x402." },
    { n: 3, title: "Technical content — x402 quickstart", channel: "content", cat: "content", kol: null, budget: 40, spent: 31, conv: 14, visits: 52, started: 5, hypothesis: "A copy-paste x402 quickstart will convert developers searching for agent payments examples." },
  ];
  for (const h of history) {
    const kol = h.kol ? await kolByHandle(h.kol) : undefined;
    const [opp] = kol ? await db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, projectId), eq(s.opportunities.subjectKey, `kol:${kol.id}`))) : [];
    if (opp) await db.update(s.opportunities).set({ status: "experiment" }).where(eq(s.opportunities.id, opp.id));
    const expId = newId();
    await db.insert(s.experiments).values({
      id: expId,
      projectId,
      missionId,
      opportunityId: opp?.id ?? null,
      number: h.n,
      title: h.title,
      hypothesis: h.hypothesis,
      channel: h.channel,
      budgetCategory: h.cat,
      target: `${Math.ceil(h.budget / 30) * 5} qualified developer visits`,
      action: h.channel === "kol" ? "Sponsored post + tracked link, two tranches" : "Commissioned quickstart + distribution in active threads",
      budgetMicro: toMicro(h.budget),
      successEvent: "sdk_key_created",
      successTarget: Math.max(2, Math.ceil(h.budget / 30)),
      stopMaxCpaMicro: toMicro(30),
      stopAfterSpendMicro: toMicro(h.budget / 2),
      timeframeDays: 7,
      startsAt: new Date(now - h.started * DAY_MS),
      status: "running",
      dataMode: "DEMO",
    });
    const code = shortCode(8);
    const [camp] = await db
      .insert(s.campaigns)
      .values({ id: newId(), experimentId: expId, kolId: kol?.id ?? null, name: h.title, channel: h.channel, utmSource: kol ? utmSlug(`${kol.provider}_${kol.handle}`) : "content", utmMedium: h.channel === "kol" ? "creator" : "content", utmCampaign: utmSlug(`exp${h.n}_first_100_devs`), referralCode: code, destinationUrl: "https://meterline.example" })
      .returning();
    const d = await recordDecision(db, {
      projectId,
      missionId,
      agent: "operator",
      kind: "send_payment",
      action: { action: "send_payment", purpose: h.channel === "kol" ? "kol_payment" : "campaign_payment", amount: String(h.spent), currency: "USDC", chain: ARC.appKitChain, experimentId: expId, missionId },
      rationale: `Seeded DEMO history: spend for experiment #${h.n}.`,
      status: "executed",
      autonomous: false,
      dataMode: "DEMO",
    });
    const { tx } = await createTransaction(db, { projectId, decisionId: d.id, missionId, experimentId: expId, kind: "send", rail: "app_kit_send", budgetCategory: h.cat, amountMicro: toMicro(h.spent), chain: ARC.appKitChain, recipient: null, idempotencyKey: sha256(`demo-history-${projectId}-${h.n}`), dataMode: "SIMULATED" });
    await db.update(s.transactions).set({ createdAt: new Date(now - h.started * DAY_MS) }).where(eq(s.transactions.id, tx.id));
    await transition(db, tx.id, "AUTHORIZED", {}, "DEMO history");
    await transition(db, tx.id, "EXECUTING");
    await transition(db, tx.id, "SIMULATED", { error: "DEMO history — no funds moved" }, "DEMO history — no funds moved");
    await writeReceipt(db, d.id);
    for (let i = 0; i < h.visits; i++) {
      const visitor = `demo-v-${h.n}-${i}`;
      const t = new Date(now - h.started * DAY_MS + ((i + 1) / (h.visits + 1)) * (h.started - 0.5) * DAY_MS);
      await recordConversion(db, { projectId, eventType: "visit", referralCode: camp.referralCode, visitorId: visitor, idempotencyKey: `demo-${projectId}-${h.n}-visit-${i}`, occurredAt: t, source: "demo", dataMode: "DEMO" });
      if (i < h.conv) await recordConversion(db, { projectId, eventType: "sdk_key_created", referralCode: camp.referralCode, visitorId: visitor, idempotencyKey: `demo-${projectId}-${h.n}-key-${i}`, occurredAt: new Date(t.getTime() + 3_600_000), source: "demo", dataMode: "DEMO" });
    }
  }
  return projectId;
}
