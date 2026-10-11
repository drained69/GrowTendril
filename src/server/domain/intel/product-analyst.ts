import { z } from "zod";
import { aiName, aiStructured } from "@/server/integrations/llm";
import { readPage, readGithubReadme, type PageText } from "@/server/domain/intel/crawl";
import { AUDIENCES, audienceUsers, detectAudience, heuristicKeywords, pickCategory, siteTerms, targetUsersFrom, type Audience } from "@/server/domain/intel/market-taxonomy";

/**
 * PRODUCT ANALYST — builds the Product Intelligence Profile from public pages the founder
 * points at. Claude reads the pages when configured; otherwise a transparent heuristic
 * extracts what it can and leaves the rest for the founder to fill in.
 */

export const ProductProfileSchema = z.object({
  summary: z.string().describe("Two sentences: what the product does and for whom"),
  category: z.string(),
  audience: z.enum(AUDIENCES).describe("Who mainly buys or uses it: businesses (B2B), consumers (B2C), or developers (technical users)"),
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
  /** Founder's own answer to "who are your customers?"; overrides detection. */
  audience?: Audience | null;
  /** Competitors the product's own site names (comparison pages, "alternative to …"). */
  competitors?: string[];
  /** Where a local business operates, when the site states it. */
  location?: string | null;
}

export interface AnalysisResult {
  profile: ProductProfile;
  generatedBy: "claude" | "heuristic";
  crawled: { url: string; ok: boolean; note?: string }[];
  note: string;
}

const INTEGRATIONS = /\b(shopify|woocommerce|etsy|amazon|stripe|paypal|square|quickbooks|xero|salesforce|hubspot|slack|zapier|notion|google sheets|gmail|outlook|microsoft teams|zoom|instagram|tiktok|whatsapp|mailchimp|wordpress|webflow|figma|jira|openai|anthropic|langchain|python|typescript|next\.js|rust|ethereum|solana|arbitrum|polygon|circle|usdc)\b/g;

/** Headings that organise a page rather than say what the product does. */
const NAV_HEADING = /^(welcome|home|about|our (story|team|values|mission)|who we are|meet |contact|menu|gift cards?|shop |news|happenings|follow|join |sign up|subscribe|faq|frequently asked|work with us|careers|press)\b/i;

function heuristicProfile(input: ProductInput, pages: PageText[]): ProductProfile {
  const pagesText = pages.flatMap((p) => [p.title ?? "", p.description ?? "", ...p.headings, p.text.slice(0, 4000)]).join("\n");
  const headingText = pages.flatMap((p) => [p.title ?? "", p.description ?? "", ...p.headings]).join("\n");
  const corpus = `${input.description}\n${pagesText}`.toLowerCase();
  const { primary, secondary } = pickCategory(input.description, pagesText);
  const audience = input.audience ?? detectAudience(input.description, pagesText, primary.audience);
  const pricing = corpus.match(/\$\s?\d+[\d,.]*\s*(\/|per)\s*(mo|month|year|yr|week|wk|user|seat|order|box|request|call)\b/)?.[0] ?? null;
  const terms = siteTerms(
    [{ text: input.description, weight: 3 }, ...pages.flatMap((p) => [{ text: [p.title ?? "", p.description ?? "", ...p.headings].join("\n"), weight: 3 }, { text: p.text.slice(0, 6000), weight: 1 }])],
    [input.name, ...(input.website ? [new URL(input.website).hostname.replace(/^www\./, "").split(".")[0]] : []), ...(input.competitors ?? [])],
  );
  const keywords = heuristicKeywords(input.location && !input.description.includes(input.location.split(",")[0]) ? `${input.description} Based in ${input.location}.` : input.description, headingText, primary, secondary?.terms, { siteTerms: terms, name: input.name, corpus });
  return {
    summary: pages.find((p) => p.description)?.description ?? input.description,
    category: secondary ? `${primary.category} · ${secondary.category}` : primary.category,
    audience,
    targetUsers: [...new Set([...targetUsersFrom(input.description), ...audienceUsers(primary, audience)])].slice(0, 4),
    competitors: input.competitors ?? [],
    valueProps: [...new Set(pages.flatMap((p) => p.headings))]
      .filter((h) => h.split(" ").length >= 3 && h.split(" ").length <= 12 && !NAV_HEADING.test(h))
      // "SPECIAL ORDER CAKES" → "Special order cakes"
      .map((h) => (h === h.toUpperCase() ? h.charAt(0) + h.slice(1).toLowerCase() : h))
      .slice(0, 5),
    integrations: [...new Set(corpus.match(INTEGRATIONS) ?? [])].slice(0, 10),
    useCases: [],
    pricing,
    // Category language only when the site or founder actually uses it ("telehealth" isn't a dental clinic's word).
    terminology: [...new Set([...[...primary.terminology, ...(secondary?.terminology ?? [])].filter((t) => corpus.includes(t.toLowerCase())), ...keywords.slice(0, 6)])].slice(0, 12),
    keywords: keywords.length ? keywords : [input.name],
  };
}

export async function analyzeProduct(input: ProductInput, opts: { pages?: PageText[] } = {}): Promise<AnalysisResult> {
  const tasks: Promise<PageText>[] = [];
  if (input.website && !opts.pages) tasks.push(readPage(input.website));
  if (input.docsUrl) tasks.push(readPage(input.docsUrl));
  if (input.githubUrl) tasks.push(readGithubReadme(input.githubUrl));
  const pages = [...(opts.pages ?? []), ...(await Promise.all(tasks))];
  const crawled = pages.map((p) => ({ url: p.url, ok: p.ok, note: p.note }));
  const readable = pages.filter((p) => p.ok);

  const material = [
    `PRODUCT NAME: ${input.name}`,
    `FOUNDER DESCRIPTION: ${input.description}`,
    input.xHandle ? `X ACCOUNT: @${input.xHandle.replace(/^@/, "")}` : "",
    input.audience ? `CUSTOMERS (stated by founder): ${input.audience}` : "",
    input.location ? `LOCATION: ${input.location}` : "",
    input.competitors?.length ? `COMPETITORS NAMED ON THE SITE: ${input.competitors.join(", ")}` : "",
    ...readable.map((p) => `\n--- SOURCE ${p.url} ---\nTITLE: ${p.title ?? ""}\nDESCRIPTION: ${p.description ?? ""}\nHEADINGS: ${p.headings.join(" | ")}\nTEXT: ${p.text.slice(0, 9000)}`),
  ].join("\n");

  const ai = await aiStructured({
    schema: ProductProfileSchema,
    system:
      "You are the Product Analyst inside GrowTendril. Build a factual product profile strictly from the provided sources. " +
      "Never invent competitors, integrations, customers or pricing that the sources do not state or clearly imply; use empty arrays or null instead. " +
      "The product can be anything: a local business, a consumer app, a shop, a service, B2B software or a developer tool. Describe it in its own market's terms. " +
      "Keywords must be short search phrases people actually use in public conversations about this space.",
    user: material,
    effort: "medium",
  });
  if (ai.data) {
    return { profile: { ...ai.data, audience: input.audience ?? ai.data.audience }, generatedBy: "claude", crawled, note: `Profile drafted by ${aiName()} from ${readable.length} public source(s). Review and correct anything wrong.` };
  }
  return {
    profile: heuristicProfile(input, readable),
    generatedBy: "heuristic",
    crawled,
    note: `${ai.error ?? "AI unavailable"} — used the deterministic heuristic on ${readable.length} readable source(s). Competitors and use cases need founder input.`,
  };
}

function heuristicIcp(profile: ProductProfile): IcpProposal[] {
  const cat = profile.category.toLowerCase();
  const terms = profile.keywords.slice(0, 3);
  const about = terms.join(", ") || profile.category;
  const people = profile.targetUsers.length ? profile.targetUsers : ["Early adopters"];
  if (profile.audience === "developers" && cat.includes("agent")) {
    return [
      { tier: "primary", title: "AI agent developers", description: "Teams shipping agents that call paid APIs or move money", companySize: "2–50", segments: ["agent developers", "AI startups", "developer"], signals: ["Asks how agents pay for APIs", "Building with MCP / tool use", "Mentions " + about] },
      { tier: "secondary", title: "Developer tooling companies", description: "API businesses exploring usage-based machine payments", companySize: "10–200", segments: ["developer tools", "API providers"], signals: ["Discussing usage-based pricing", "Exploring x402"] },
    ];
  }
  if (profile.audience === "developers") {
    return [
      { tier: "primary", title: `Teams building with ${profile.category}`, description: `Engineering teams whose public work overlaps ${about}`, companySize: "10–100", segments: people.map((t) => t.toLowerCase()), signals: ["Public questions about " + (terms[0] ?? "the category"), "Hiring engineers for relevant roles", "Recent launch in the category"] },
      { tier: "secondary", title: "Developers evaluating alternatives", description: "Individual developers comparing tools in this category", companySize: null, segments: ["developer"], signals: ["Asks for recommendations", "Complains about incumbents"] },
    ];
  }
  if (profile.audience === "consumers") {
    return [
      { tier: "primary", title: people[0], description: `People who talk publicly about ${about} and want a better option`, companySize: null, segments: people.map((t) => t.toLowerCase()), signals: ["Asks for recommendations about " + (terms[0] ?? "the category"), "Complains about current options", "Shares a need you solve"] },
      { tier: "secondary", title: "People switching from an alternative", description: `Customers of similar ${profile.category.toLowerCase()} options who voice frustration or curiosity`, companySize: null, segments: ["switchers"], signals: ["Mentions a competitor", "Asks for alternatives"] },
      { tier: "secondary", title: "Communities and recommenders", description: "Local groups, creators and reviewers whose audience trusts their picks", companySize: null, segments: ["community", "reviewers"], signals: ["Shares recommendations", "Runs a relevant community"] },
    ];
  }
  return [
    { tier: "primary", title: `Companies that need ${profile.category}`, description: `Businesses whose public activity overlaps ${about}`, companySize: "10–200", segments: people.map((t) => t.toLowerCase()), signals: ["Public questions about " + (terms[0] ?? "the category"), "Hiring for relevant roles", "Recent launch or expansion"] },
    { tier: "secondary", title: "Teams replacing an incumbent", description: "Companies voicing frustration with their current provider", companySize: "10–500", segments: ["switchers"], signals: ["Asks for recommendations", "Complains about incumbents", "Announces a migration"] },
  ];
}

export async function proposeIcp(profile: ProductProfile, productName: string): Promise<{ icps: IcpProposal[]; generatedBy: "claude" | "heuristic"; note: string }> {
  const ai = await aiStructured({
    schema: IcpSchema,
    system:
      "You are the Product Analyst inside GrowTendril. Propose one primary and up to three secondary Ideal Customer Profiles for the product. " +
      "For business products the ICPs are kinds of companies; for consumer products they are kinds of people; for developer products they are technical teams. " +
      "Each ICP needs public, observable signals that would show it is in-market now (questions, complaints, launches, hiring, switching). Be specific; avoid generic personas. " +
      "Leave companySize null for consumer ICPs.",
    user: `PRODUCT: ${productName}\nPROFILE:\n${JSON.stringify(profile, null, 2)}`,
    effort: "low",
  });
  if (ai.data) return { icps: ai.data.icps, generatedBy: "claude", note: `ICP drafted by ${aiName()}. Edit freely.` };
  return { icps: heuristicIcp(profile), generatedBy: "heuristic", note: `${ai.error ?? "AI unavailable"} — ICP generated from category templates.` };
}
