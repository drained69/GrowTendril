import { z } from "zod";
import { claudeStructured } from "@/server/integrations/llm/claude";
import { readPage, readSite, readGithubReadme, type PageText } from "@/server/domain/intel/crawl";
import { frequentBigrams, tokenize } from "@/server/domain/intel/narratives";
import { countryName, describeLocation, detectLocation, NO_LOCATION, type MarketLocation, type MarketScope } from "@/server/domain/intel/location";
import { discoverCompetitors, mergeCompetitors, siteNamedCompetitors, type CompetitorRecord } from "@/server/domain/intel/competitors";

/**
 * PRODUCT ANALYST — builds the Product Intelligence Profile from public pages the founder
 * points at. Claude reads the pages when configured; otherwise a transparent heuristic
 * extracts what it can and leaves the rest for the founder to fill in.
 */

export const ProductProfileSchema = z.object({
  summary: z.string().describe("Two sentences: what the product does and for whom"),
  category: z.string(),
  targetUsers: z.array(z.string()).max(8),
  competitors: z.array(z.string()).max(10).describe("Only competitors named or clearly implied by the source pages"),
  valueProps: z.array(z.string()).max(8),
  integrations: z.array(z.string()).max(12),
  useCases: z.array(z.string()).max(8),
  pricing: z.string().nullable().describe("Pricing as stated on the pages, or null if not stated"),
  terminology: z.array(z.string()).max(20).describe("Distinctive terms the market uses for this space"),
  keywords: z.array(z.string()).max(12).describe("Short search terms (1-3 words) to find relevant public conversations"),
});
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

export const IcpSchema = z.object({
  icps: z
    .array(
      z.object({
        tier: z.enum(["primary", "secondary"]),
        title: z.string(),
        description: z.string(),
        companySize: z.string().nullable(),
        segments: z.array(z.string()).max(6),
        signals: z.array(z.string()).max(6).describe("Public signals that indicate this ICP is in-market now"),
      }),
    )
    .min(1)
    .max(5),
});
export type IcpProposal = z.infer<typeof IcpSchema>["icps"][number];

export interface MarketInput {
  countryCode: string;
  region?: string | null;
  city?: string | null;
  scope?: MarketScope | null;
}

export interface ProductInput {
  name: string;
  website?: string | null;
  docsUrl?: string | null;
  xHandle?: string | null;
  githubUrl?: string | null;
  description: string;
  /** Founder-stated market; overrides detection. */
  market?: MarketInput | null;
}

export interface AnalysisResult {
  profile: ProductProfile;
  generatedBy: "claude" | "heuristic";
  crawled: { url: string; ok: boolean; note?: string }[];
  location: MarketLocation;
  competitorDetails: CompetitorRecord[];
  note: string;
}

export function founderLocation(m: MarketInput): MarketLocation {
  const city = m.city?.trim() || null;
  return { countryCode: m.countryCode, country: countryName(m.countryCode), region: m.region?.trim() || null, city, scope: m.scope ?? (city ? "local" : "national"), confidence: "high", source: "founder", evidence: ["set by you"] };
}

const CATEGORIES: { category: string; terms: string[]; competitors: string[]; terminology: string[] }[] = [
  { category: "AI agent infrastructure", terms: ["agent", "agents", "autonomous", "mcp", "llm", "tool calling", "x402"], competitors: [], terminology: ["AI agents", "agent payments", "x402", "MCP", "tool use", "autonomous agents"] },
  { category: "Stablecoin payments", terms: ["stablecoin", "usdc", "payments", "payouts", "settlement", "checkout"], competitors: [], terminology: ["stablecoins", "USDC", "payments", "settlement", "on-chain payments"] },
  { category: "Developer tooling", terms: ["sdk", "api", "cli", "developers", "library", "open source"], competitors: [], terminology: ["SDK", "API", "developer experience", "integration"] },
  { category: "Web3 infrastructure", terms: ["blockchain", "onchain", "on-chain", "smart contract", "rpc", "wallet", "chain"], competitors: [], terminology: ["wallets", "smart contracts", "cross-chain", "RPC"] },
  { category: "SaaS & business software", terms: ["saas", "platform", "workflow", "automation", "crm", "teams", "b2b", "subscription", "integrations"], competitors: [], terminology: ["workflow automation", "team collaboration", "integrations", "reporting"] },
  { category: "E-commerce & consumer products", terms: ["shop", "store", "order", "shipping", "delivery", "collection", "brand", "gift", "free returns", "buy"], competitors: [], terminology: ["online store", "shipping", "reviews", "gifts", "returns"] },
  { category: "Marketplaces & local services", terms: ["marketplace", "booking", "appointment", "book a", "local", "hire", "service provider", "listings", "rent"], competitors: [], terminology: ["booking", "local services", "listings", "providers"] },
  { category: "Education & community", terms: ["course", "learn", "lessons", "students", "curriculum", "newsletter", "community", "cohort", "membership"], competitors: [], terminology: ["online course", "learning", "community", "cohort"] },
  { category: "Health & wellness", terms: ["health", "fitness", "wellness", "patients", "clinic", "nutrition", "therapy", "sleep", "habit"], competitors: [], terminology: ["wellness", "fitness", "habits", "health tracking"] },
  { category: "Finance & fintech", terms: ["banking", "lending", "invest", "insurance", "budgeting", "accounting", "invoice", "loans", "savings"], competitors: [], terminology: ["personal finance", "invoicing", "lending", "budgeting"] },
  { category: "Data & analytics", terms: ["analytics", "data", "dashboard", "insights", "metrics"], competitors: [], terminology: ["analytics", "data pipeline", "insights"] },
];

const TARGET_USERS: Record<string, string[]> = {
  "AI agent infrastructure": ["Developers", "Technical founders", "Platform teams"],
  "Stablecoin payments": ["Developers", "Finance and payments teams"],
  "Developer tooling": ["Developers", "Technical founders", "Platform teams"],
  "Web3 infrastructure": ["Developers", "Protocol and platform teams"],
  "SaaS & business software": ["Operations leaders", "Team leads", "Founders"],
  "E-commerce & consumer products": ["Shoppers", "Gift buyers", "Brand-loyal customers"],
  "Marketplaces & local services": ["Customers booking services", "Service providers"],
  "Education & community": ["Learners", "Parents and students", "Community members"],
  "Health & wellness": ["Health-conscious consumers", "Patients and clients", "Practitioners"],
  "Finance & fintech": ["Consumers managing money", "Small-business owners", "Finance teams"],
  "Data & analytics": ["Data teams", "Product teams"],
};

const CONSUMER_CATEGORIES = new Set(["E-commerce & consumer products", "Marketplaces & local services", "Education & community", "Health & wellness"]);

/** No category matched: stay neutral and let the founder's own words drive the keywords. */
const GENERAL_CATEGORY = { category: "General product", terms: [] as string[], competitors: [] as string[], terminology: [] as string[] };

function heuristicProfile(input: ProductInput, pages: PageText[]): ProductProfile {
  const corpus = [input.description, ...pages.flatMap((p) => [p.title ?? "", p.description ?? "", ...p.headings, p.text.slice(0, 4000)])].join("\n").toLowerCase();
  const scored = CATEGORIES.map((c) => ({ c, n: c.terms.filter((t) => corpus.includes(t)).length })).sort((a, b) => b.n - a.n);
  const top = scored[0].n ? scored[0].c : GENERAL_CATEGORY;
  const second = scored[1]?.n ? scored[1].c : null;
  const bigrams = frequentBigrams(pages.map((p) => [...p.headings, p.description ?? ""].join(" ")).concat(input.description), 1, 15);
  const descTokens = tokenize(input.description).filter((t) => t.length > 3);
  const keywords = [...new Set([...top.terminology.slice(0, 4), ...(second?.terminology.slice(0, 2) ?? []), ...bigrams.slice(0, 4)])].slice(0, 10);
  const pricing = corpus.match(/(?:[$£€₦₹¥]|ngn|usd|gbp|eur|kes|ghs|zar|inr)\s?\d[\d,.]*\s*(?:\/|per)\s*(?:mo|month|year|yr|user|seat|request|call|hour|session|night)\b/i)?.[0] ?? null;
  return {
    summary: pages.find((p) => p.description)?.description ?? input.description,
    category: second ? `${top.category} · ${second.category}` : top.category,
    targetUsers: TARGET_USERS[top.category] ?? ["People and teams who match the description you gave"],
    competitors: [],
    valueProps: pages.flatMap((p) => p.headings).filter((h) => h.split(" ").length >= 3 && h.split(" ").length <= 12).slice(0, 5),
    // Words like "base", "arc" and "circle" are ordinary English, so they only count with a qualifier.
    integrations: [...new Set((corpus.match(/\b(base (?:chain|network|mainnet)|arc (?:network|testnet|mainnet)|circle (?:api|wallets|usdc)|solana|ethereum|arbitrum|polygon|langchain|openai|anthropic|next\.js|typescript|stripe|paystack|flutterwave|shopify|woocommerce|salesforce|hubspot|slack|zapier|quickbooks|xero|whatsapp)\b/g) ?? []))].slice(0, 10),
    useCases: [],
    pricing,
    terminology: [...new Set([...top.terminology, ...descTokens.slice(0, 6)])].slice(0, 15),
    keywords,
  };
}

const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

/** Drops claims that the sources don't contain: integrations, named competitors and pricing figures. */
export function groundProfile(profile: ProductProfile, corpus: string): { profile: ProductProfile; dropped: string[] } {
  const text = norm(corpus);
  const has = (v: string) => text.includes(norm(v).trim());
  const dropped: string[] = [];
  const keep = (label: string, xs: string[]) =>
    xs.filter((x) => {
      const first = x.split(/[\s(]/)[0] ?? "";
      const ok = has(x) || (first.length >= 5 && has(first));
      if (!ok) dropped.push(`${label} "${x}"`);
      return ok;
    });
  let pricing = profile.pricing;
  if (pricing) {
    const figures = pricing.match(/\d[\d,.]*/g) ?? [];
    const words = pricing.match(/[a-z]{4,}/gi) ?? [];
    const grounded = figures.length ? figures.every((f) => text.includes(f.replace(/[.,]$/, ""))) : words.some((w) => has(w));
    if (!grounded) {
      dropped.push(`pricing "${pricing}"`);
      pricing = null;
    }
  }
  return { profile: { ...profile, integrations: keep("integration", profile.integrations), competitors: keep("competitor", profile.competitors), pricing }, dropped };
}

function structuredFacts(pages: PageText[]): string {
  const facts: string[] = [];
  for (const p of pages)
    for (const o of p.jsonLd ?? []) {
      const pick = Object.fromEntries(["@type", "name", "description", "address", "areaServed", "priceRange", "telephone", "offers", "openingHours"].filter((k) => o[k] != null).map((k) => [k, o[k]]));
      if (Object.keys(pick).length > 1) facts.push(JSON.stringify(pick).slice(0, 800));
    }
  return facts.slice(0, 6).join("\n");
}

export async function analyzeProduct(input: ProductInput): Promise<AnalysisResult> {
  const [site, others] = await Promise.all([
    input.website ? readSite(input.website) : Promise.resolve<PageText[]>([]),
    Promise.all([input.docsUrl ? readPage(input.docsUrl) : null, input.githubUrl ? readGithubReadme(input.githubUrl) : null].filter((x): x is Promise<PageText> => !!x)),
  ]);
  const pages = [...site, ...others];
  const crawled = pages.map((p) => ({ url: p.url, ok: p.ok, note: p.note }));
  const readable = pages.filter((p) => p.ok);
  const location = input.market ? founderLocation(input.market) : input.website ? detectLocation(site, input.website) : NO_LOCATION;
  const corpus = [input.description, ...readable.flatMap((p) => [p.title ?? "", p.description ?? "", ...p.headings, p.text, JSON.stringify(p.jsonLd ?? [])])].join("\n");

  const facts = structuredFacts(readable);
  const material = [
    `PRODUCT NAME: ${input.name}`,
    `FOUNDER DESCRIPTION: ${input.description}`,
    `MARKET: ${describeLocation(location)}${location.evidence.length ? ` (evidence: ${location.evidence.join("; ")})` : ""}`,
    input.xHandle ? `X ACCOUNT: @${input.xHandle.replace(/^@/, "")}` : "",
    facts ? `STRUCTURED DATA FROM THE SITE:\n${facts}` : "",
    ...readable.map((p) => `\n--- SOURCE ${p.url} ---\nTITLE: ${p.title ?? ""}\nDESCRIPTION: ${p.description ?? ""}\nHEADINGS: ${p.headings.join(" | ")}\nTEXT: ${p.text.slice(0, p === readable[0] ? 9000 : 4000)}`),
  ].join("\n");

  const ai = await claudeStructured({
    schema: ProductProfileSchema,
    system:
      "You are the Product Analyst inside GrowTendril. Build a factual product profile strictly from the provided sources. " +
      "Never invent competitors, integrations, customers or pricing that the sources do not state; use empty arrays or null instead. " +
      "Pricing must quote figures exactly as written, with their currency. Describe the business in its real market (see MARKET). " +
      "Keywords must be short search phrases people actually use in public conversations about this space, including local terms where the business is local.",
    user: material,
    effort: "medium",
  });

  const generatedBy: AnalysisResult["generatedBy"] = ai.data ? "claude" : "heuristic";
  const grounded = ai.data ? groundProfile(ai.data, corpus) : { profile: heuristicProfile(input, readable), dropped: [] };
  const ownUrl = input.website ?? null;
  const named = siteNamedCompetitors(site, input.name, ownUrl ? new URL(/^https?:/i.test(ownUrl) ? ownUrl : `https://${ownUrl}`).hostname.replace(/^www\./, "") : null);
  const fromProfile: CompetitorRecord[] = grounded.profile.competitors.map((n) => ({ name: n, website: null, reason: "Named on your own website", source: "site", locationCheck: "not_applicable", locationNote: null, evidenceUrls: [], siteStatus: "unchecked" }));
  const discovery = await discoverCompetitors({ name: input.name, summary: grounded.profile.summary, category: grounded.profile.category, location, ownUrl, siteNamed: mergeCompetitors(named, fromProfile) });
  const profile = { ...grounded.profile, competitors: discovery.competitors.map((c) => c.name) };

  const head = ai.data
    ? `Profile drafted by Claude from ${readable.length} public page(s)`
    : `${ai.error ?? "Claude unavailable"} — used the deterministic heuristic on ${readable.length} readable page(s)`;
  const where = location.source === "founder" ? `Market: ${describeLocation(location)} (set by you)` : location.countryCode ? `Market detected: ${describeLocation(location)} (${location.confidence} confidence)` : "Market not detected — set it so competitors are local";
  const checks = grounded.dropped.length ? ` Removed ${grounded.dropped.length} claim(s) not found on your pages.` : "";
  return { profile, generatedBy, crawled, location, competitorDetails: discovery.competitors, note: `${head}. ${where}. ${discovery.note}${checks} Review and correct anything wrong.` };
}

function heuristicIcp(profile: ProductProfile): IcpProposal[] {
  const cat = profile.category.toLowerCase();
  const terms = profile.keywords.slice(0, 3);
  if (cat.includes("agent")) {
    return [
      { tier: "primary", title: "AI agent developers", description: "Teams shipping agents that call paid APIs or move money", companySize: "2–50", segments: ["agent developers", "AI startups", "developer"], signals: ["Asks how agents pay for APIs", "Building with MCP / tool use", "Mentions " + terms.join(", ")] },
      { tier: "secondary", title: "Web3 infrastructure teams", description: "Teams building developer-facing products on stablecoin rails", companySize: "10–100", segments: ["infrastructure", "web3 developers", "stablecoin"], signals: ["Stablecoin initiative announced", "Hiring smart contract engineers"] },
      { tier: "secondary", title: "Developer tooling companies", description: "API businesses exploring usage-based machine payments", companySize: "10–200", segments: ["developer tools", "API providers"], signals: ["Discussing usage-based pricing", "Exploring x402"] },
    ];
  }
  // Consumer-facing categories sell to individuals, so describe people rather than companies.
  if (CONSUMER_CATEGORIES.has(profile.category)) {
    const what = terms[0] ?? profile.category.toLowerCase();
    return [
      { tier: "primary", title: `People looking for ${what}`, description: `People whose public posts show they are asking about, comparing or looking for ${terms.join(", ") || what}`, companySize: null, segments: profile.targetUsers.map((t) => t.toLowerCase()), signals: ["Asks for recommendations", "Compares options publicly", "Complains about an alternative"] },
      { tier: "secondary", title: "People comparing alternatives", description: "Buyers publicly comparing options in this category", companySize: null, segments: ["buyers", "evaluators"], signals: ["Asks for recommendations", "Complains about incumbents"] },
    ];
  }
  return [
    { tier: "primary", title: profile.category === "General product" ? `People interested in ${terms[0] ?? "your product"}` : `Teams adopting ${profile.category}`, description: `Companies whose public activity overlaps ${terms.join(", ")}`, companySize: "10–100", segments: profile.targetUsers.map((t) => t.toLowerCase()), signals: ["Public questions about " + (terms[0] ?? "the category"), "Hiring for relevant roles", "Recent launch in the category"] },
    { tier: "secondary", title: "People comparing alternatives", description: "Buyers publicly comparing options in this category", companySize: null, segments: ["buyers", "evaluators"], signals: ["Asks for recommendations", "Complains about incumbents"] },
  ];
}

export async function proposeIcp(profile: ProductProfile, productName: string): Promise<{ icps: IcpProposal[]; generatedBy: "claude" | "heuristic"; note: string }> {
  const ai = await claudeStructured({
    schema: IcpSchema,
    system:
      "You are the Product Analyst inside GrowTendril. Propose one primary and up to three secondary Ideal Customer Profiles for the product. " +
      "Each ICP needs public, observable signals that would show a company is in-market now (launches, hiring, questions, migrations). Be specific; avoid generic personas.",
    user: `PRODUCT: ${productName}\nPROFILE:\n${JSON.stringify(profile, null, 2)}`,
    effort: "low",
  });
  if (ai.data) return { icps: ai.data.icps, generatedBy: "claude", note: "ICP drafted by Claude. Edit freely." };
  return { icps: heuristicIcp(profile), generatedBy: "heuristic", note: `${ai.error ?? "Claude unavailable"} — ICP generated from category templates.` };
}
