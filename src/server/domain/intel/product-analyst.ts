import { z } from "zod";
import { claudeStructured } from "@/server/integrations/llm/claude";
import { readPage, readGithubReadme, type PageText } from "@/server/domain/intel/crawl";
import { frequentBigrams, tokenize } from "@/server/domain/intel/narratives";

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

export interface ProductInput {
  name: string;
  website?: string | null;
  docsUrl?: string | null;
  xHandle?: string | null;
  githubUrl?: string | null;
  description: string;
}

export interface AnalysisResult {
  profile: ProductProfile;
  generatedBy: "claude" | "heuristic";
  crawled: { url: string; ok: boolean; note?: string }[];
  note: string;
}

const CATEGORIES: { category: string; terms: string[]; competitors: string[]; terminology: string[] }[] = [
  { category: "AI agent infrastructure", terms: ["agent", "agents", "autonomous", "mcp", "llm", "tool calling", "x402"], competitors: [], terminology: ["AI agents", "agent payments", "x402", "MCP", "tool use", "autonomous agents"] },
  { category: "Stablecoin payments", terms: ["stablecoin", "usdc", "payments", "payouts", "settlement", "checkout"], competitors: [], terminology: ["stablecoins", "USDC", "payments", "settlement", "on-chain payments"] },
  { category: "Developer tooling", terms: ["sdk", "api", "cli", "developers", "library", "open source"], competitors: [], terminology: ["SDK", "API", "developer experience", "integration"] },
  { category: "Web3 infrastructure", terms: ["blockchain", "onchain", "on-chain", "smart contract", "rpc", "wallet", "chain"], competitors: [], terminology: ["wallets", "smart contracts", "cross-chain", "RPC"] },
  { category: "Data & analytics", terms: ["analytics", "data", "dashboard", "insights", "metrics"], competitors: [], terminology: ["analytics", "data pipeline", "insights"] },
];

function heuristicProfile(input: ProductInput, pages: PageText[]): ProductProfile {
  const corpus = [input.description, ...pages.flatMap((p) => [p.title ?? "", p.description ?? "", ...p.headings, p.text.slice(0, 4000)])].join("\n").toLowerCase();
  const scored = CATEGORIES.map((c) => ({ c, n: c.terms.filter((t) => corpus.includes(t)).length })).sort((a, b) => b.n - a.n);
  const top = scored[0].n ? scored[0].c : CATEGORIES[2];
  const second = scored[1]?.n ? scored[1].c : null;
  const bigrams = frequentBigrams(pages.map((p) => [...p.headings, p.description ?? ""].join(" ")).concat(input.description), 1, 15);
  const descTokens = tokenize(input.description).filter((t) => t.length > 3);
  const keywords = [...new Set([...top.terminology.slice(0, 4), ...(second?.terminology.slice(0, 2) ?? []), ...bigrams.slice(0, 4)])].slice(0, 10);
  const pricing = corpus.match(/\$\s?\d+[\d,.]*\s*(\/|per)\s*(mo|month|year|request|call)/)?.[0] ?? null;
  return {
    summary: pages.find((p) => p.description)?.description ?? input.description,
    category: second ? `${top.category} · ${second.category}` : top.category,
    targetUsers: top.category === "Data & analytics" ? ["Data teams", "Product teams"] : ["Developers", "Technical founders", "Platform teams"],
    competitors: [],
    valueProps: pages.flatMap((p) => p.headings).filter((h) => h.split(" ").length >= 3 && h.split(" ").length <= 12).slice(0, 5),
    integrations: [...new Set((corpus.match(/\b(base|arc|solana|ethereum|arbitrum|polygon|langchain|openai|anthropic|next\.js|python|typescript|rust|stripe|circle)\b/g) ?? []))].slice(0, 10),
    useCases: [],
    pricing,
    terminology: [...new Set([...top.terminology, ...descTokens.slice(0, 6)])].slice(0, 15),
    keywords,
  };
}

export async function analyzeProduct(input: ProductInput): Promise<AnalysisResult> {
  const tasks: Promise<PageText>[] = [];
  if (input.website) tasks.push(readPage(input.website));
  if (input.docsUrl) tasks.push(readPage(input.docsUrl));
  if (input.githubUrl) tasks.push(readGithubReadme(input.githubUrl));
  const pages = await Promise.all(tasks);
  const crawled = pages.map((p) => ({ url: p.url, ok: p.ok, note: p.note }));
  const readable = pages.filter((p) => p.ok);

  const material = [
    `PRODUCT NAME: ${input.name}`,
    `FOUNDER DESCRIPTION: ${input.description}`,
    input.xHandle ? `X ACCOUNT: @${input.xHandle.replace(/^@/, "")}` : "",
    ...readable.map((p) => `\n--- SOURCE ${p.url} ---\nTITLE: ${p.title ?? ""}\nDESCRIPTION: ${p.description ?? ""}\nHEADINGS: ${p.headings.join(" | ")}\nTEXT: ${p.text.slice(0, 9000)}`),
  ].join("\n");

  const ai = await claudeStructured({
    schema: ProductProfileSchema,
    system:
      "You are the Product Analyst inside GrowTendril. Build a factual product profile strictly from the provided sources. " +
      "Never invent competitors, integrations, customers or pricing that the sources do not state or clearly imply; use empty arrays or null instead. " +
      "Keywords must be short search phrases people actually use in public conversations about this space.",
    user: material,
    effort: "medium",
  });
  if (ai.data) {
    return { profile: ai.data, generatedBy: "claude", crawled, note: `Profile drafted by Claude from ${readable.length} public source(s). Review and correct anything wrong.` };
  }
  return {
    profile: heuristicProfile(input, readable),
    generatedBy: "heuristic",
    crawled,
    note: `${ai.error ?? "Claude unavailable"} — used the deterministic heuristic on ${readable.length} readable source(s). Competitors and use cases need founder input.`,
  };
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
  return [
    { tier: "primary", title: `Teams adopting ${profile.category}`, description: `Companies whose public activity overlaps ${terms.join(", ")}`, companySize: "10–100", segments: profile.targetUsers.map((t) => t.toLowerCase()), signals: ["Public questions about " + (terms[0] ?? "the category"), "Hiring for relevant roles", "Recent launch in the category"] },
    { tier: "secondary", title: "Developers evaluating alternatives", description: "Individual developers comparing tools in this category", companySize: null, segments: ["developer"], signals: ["Asks for recommendations", "Complains about incumbents"] },
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
