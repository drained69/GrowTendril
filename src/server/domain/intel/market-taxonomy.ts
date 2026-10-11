import { termHits } from "@/server/domain/intel/signals";

/**
 * Deterministic market taxonomy for the product analyst when Claude is unavailable.
 * Covers consumer, business and developer products alike; the founder can correct
 * every field afterwards, so this only has to be a sensible, transparent first draft.
 */

export const AUDIENCES = ["businesses", "consumers", "developers"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  businesses: "Businesses (B2B)",
  consumers: "Consumers (B2C)",
  developers: "Developers & technical teams",
};

export interface MarketCategory {
  category: string;
  audience: Audience;
  /** Whole-word cues matched against the founder's description and public pages. */
  terms: string[];
  targetUsers: string[];
  /** Broad phrases people use when talking about the space. */
  terminology: string[];
}

export const CATEGORIES: MarketCategory[] = [
  { category: "Food & beverage", audience: "consumers", terms: ["food", "foodie", "bakery", "baker", "bakers", "baking", "bread", "sourdough", "pastry", "pastries", "cake", "cakes", "restaurant", "cafe", "coffee", "tea", "meal", "meals", "meal kit", "recipe", "recipes", "snack", "snacks", "beverage", "drinks", "kitchen", "catering", "grocery", "groceries", "chef", "wine", "beer", "vegan", "organic"], targetUsers: ["Food lovers", "Households", "Local customers"], terminology: ["food delivery", "local food"] },
  { category: "E-commerce & retail", audience: "consumers", terms: ["shop", "online store", "ecommerce", "e-commerce", "shopify", "apparel", "fashion", "clothing", "shoes", "sneakers", "jewelry", "skincare", "beauty", "cosmetics", "handmade", "gifts", "dtc", "retail", "boutique"], targetUsers: ["Online shoppers", "Gift buyers"], terminology: ["online shopping", "gift ideas"] },
  { category: "Home & living", audience: "consumers", terms: ["bedding", "sheets", "linens", "duvet", "comforter", "comforters", "pillow", "pillows", "mattress", "mattresses", "towels", "furniture", "sofa", "sofas", "rugs", "candles", "home decor", "decor", "cookware", "kitchenware", "homewares", "interiors"], targetUsers: ["Homeowners and renters", "People furnishing a new home"], terminology: ["home decor", "bedroom ideas"] },
  { category: "Health & wellness", audience: "consumers", terms: ["fitness", "workout", "workouts", "gym", "wellness", "nutrition", "yoga", "pilates", "meditation", "sleep", "therapy", "mental health", "diet", "weight loss", "supplements", "healthy"], targetUsers: ["Health-conscious adults", "People starting a fitness habit"], terminology: ["fitness routine", "healthy habits"] },
  { category: "Healthcare", audience: "businesses", terms: ["clinic", "clinics", "patients", "doctor", "doctors", "medical", "dental", "dentist", "dentists", "healthcare", "practice management", "telehealth", "pharmacy", "hospital", "nurses"], targetUsers: ["Clinics", "Healthcare practices"], terminology: ["patient experience", "telehealth"] },
  { category: "Education & learning", audience: "consumers", terms: ["course", "courses", "students", "teachers", "school", "tutoring", "tutor", "education", "edtech", "lessons", "bootcamp", "exam", "language learning", "classes"], targetUsers: ["Learners", "Students", "Parents"], terminology: ["online course", "study tips"] },
  { category: "Travel & hospitality", audience: "consumers", terms: ["travel", "hotel", "hotels", "vacation", "vacations", "tour", "tours", "flights", "hostel", "hospitality", "itinerary", "destination", "airbnb", "holiday"], targetUsers: ["Travelers", "Holiday planners"], terminology: ["trip planning", "where to stay"] },
  { category: "Home & local services", audience: "consumers", terms: ["cleaning", "plumbing", "plumber", "salon", "barber", "repair", "repairs", "movers", "landscaping", "lawn", "pet", "pets", "dog", "dogs", "grooming", "childcare", "babysitting", "home services", "contractor", "handyman", "laundry", "photography", "wedding"], targetUsers: ["Homeowners", "Local residents"], terminology: ["near me", "local recommendations"] },
  { category: "Media, creators & community", audience: "consumers", terms: ["newsletter", "podcast", "creator", "creators", "video", "videos", "youtube", "membership", "fans", "blog", "magazine", "books", "author", "artists"], targetUsers: ["Readers and listeners", "Fans of the niche"], terminology: ["newsletter", "podcast"] },
  { category: "Games & entertainment", audience: "consumers", terms: ["game", "games", "gaming", "gamers", "players", "esports", "indie game", "indiegame", "indiedev", "gamedev", "steam", "wishlist", "playtest", "nintendo", "playstation", "xbox", "music", "musicians", "streaming", "movie", "movies", "festival", "tickets", "board game", "puzzle"], targetUsers: ["Players", "Fans"], terminology: ["indie game", "new release"] },
  { category: "Personal finance", audience: "consumers", terms: ["budgeting", "personal finance", "savings", "save money", "investing", "credit score", "debt", "retirement", "money app"], targetUsers: ["People managing their money"], terminology: ["budgeting", "saving money"] },
  { category: "Finance & accounting software", audience: "businesses", terms: ["accounting", "invoicing", "invoices", "payroll", "bookkeeping", "expenses", "expense management", "tax", "taxes", "billing", "accounts payable", "cfo", "finance teams"], targetUsers: ["Finance teams", "Small business owners", "Accountants"], terminology: ["accounting software", "invoicing"] },
  { category: "Marketing & sales software", audience: "businesses", terms: ["marketing", "seo", "ads", "advertising", "leads", "lead generation", "sales", "crm", "email marketing", "social media management", "outreach", "landing pages", "campaigns"], targetUsers: ["Marketing teams", "Sales teams", "Founders"], terminology: ["lead generation", "customer acquisition"] },
  { category: "Team & productivity software", audience: "businesses", terms: ["saas", "workflow", "workflows", "productivity", "project management", "issue tracking", "issues", "roadmap", "roadmaps", "sprints", "backlog", "collaboration", "automation", "automate", "scheduling", "meetings", "documents", "knowledge base", "customer support", "helpdesk", "b2b", "enterprise", "operations"], targetUsers: ["Operations teams", "Team leads", "Small businesses"], terminology: ["workflow automation", "productivity tools"] },
  { category: "HR & recruiting", audience: "businesses", terms: ["hiring", "recruiting", "recruiters", "candidates", "human resources", "employees", "talent", "job board", "applicant tracking", "benefits", "performance reviews"], targetUsers: ["HR teams", "Recruiters", "Hiring managers"], terminology: ["recruiting", "hiring process"] },
  { category: "Real estate & property", audience: "consumers", terms: ["real estate", "property", "properties", "rental", "rentals", "tenants", "landlord", "landlords", "apartment", "apartments", "homes for sale", "mortgage", "realtor", "home buyers"], targetUsers: ["Home buyers", "Renters", "Landlords"], terminology: ["real estate", "home buying"] },
  { category: "Agency & professional services", audience: "businesses", terms: ["agency", "consulting", "consultancy", "consultant", "design studio", "law firm", "lawyers", "legal", "accounting firm", "freelance", "freelancers", "advisory", "outsourcing"], targetUsers: ["Founders", "Marketing leads", "Operations leads"], terminology: ["hire an agency", "consulting"] },
  { category: "Logistics & supply chain", audience: "businesses", terms: ["logistics", "freight", "fleet", "warehouse", "warehousing", "supply chain", "inventory", "fulfillment", "last mile", "couriers"], targetUsers: ["Operations teams", "E-commerce brands"], terminology: ["fulfillment", "supply chain"] },
  { category: "Nonprofit & social impact", audience: "consumers", terms: ["nonprofit", "non-profit", "charity", "donations", "donate", "volunteers", "fundraising", "social impact", "foundation", "ngo"], targetUsers: ["Supporters", "Volunteers", "Donors"], terminology: ["fundraising", "volunteering"] },
  { category: "Security & compliance", audience: "businesses", terms: ["security", "cybersecurity", "compliance", "soc 2", "gdpr", "privacy", "vulnerability", "threat", "access management", "encryption"], targetUsers: ["Security teams", "IT leaders"], terminology: ["cybersecurity", "compliance"] },
  { category: "Data & analytics", audience: "businesses", terms: ["analytics", "dashboard", "dashboards", "insights", "metrics", "reporting", "business intelligence"], targetUsers: ["Data teams", "Product teams"], terminology: ["analytics", "reporting"] },
  { category: "AI products", audience: "businesses", terms: ["ai", "artificial intelligence", "llm", "chatbot", "gpt", "machine learning", "assistant", "generative"], targetUsers: ["Teams adopting AI", "Founders"], terminology: ["AI tools", "AI assistant"] },
  { category: "AI agent infrastructure", audience: "developers", terms: ["ai agent", "ai agents", "autonomous agents", "mcp", "tool calling", "x402", "agent payments"], targetUsers: ["AI agent developers", "AI startups"], terminology: ["AI agents", "agent payments", "MCP"] },
  { category: "Developer tools", audience: "developers", terms: ["sdk", "api", "apis", "cli", "developers", "developer", "library", "open source", "open-source", "github", "devops", "infrastructure", "framework"], targetUsers: ["Developers", "Technical founders", "Platform teams"], terminology: ["SDK", "API", "developer experience"] },
  { category: "Web3 & crypto", audience: "developers", terms: ["blockchain", "onchain", "on-chain", "crypto", "web3", "nft", "nfts", "defi", "smart contract", "smart contracts", "stablecoin", "stablecoins", "usdc", "dao", "wallets"], targetUsers: ["Web3 builders", "Crypto users"], terminology: ["web3", "stablecoins"] },
];

const GENERAL: MarketCategory = { category: "General product", audience: "businesses", terms: [], targetUsers: ["Early adopters"], terminology: [] };

const AUDIENCE_CUES: Record<Audience, RegExp> = {
  developers: /\b(developers?|engineers?|engineering teams?|devs|sdks?|apis?|cli|open[- ]source|github)\b/g,
  businesses: /\b(teams?|companies|businesses|b2b|enterprises?|startups?|agencies|smbs?|organi[sz]ations?|employees|managers|clients|saas|workflows?|brands|retailers|restaurants|clinics|practices)\b/g,
  consumers: /\b(families|family|parents|kids|people|anyone|everyone|individuals|households?|shoppers|fans|players|travell?ers|homeowners|renters|students|readers|listeners|pet owners|couples|moms|dads|beginners)\b/g,
};

const count = (re: RegExp, text: string) => text.match(re)?.length ?? 0;

/** Who buys, when the founder sells to a different audience than the category's default (a dental clinic, not dental software). */
export function audienceUsers(cat: MarketCategory, audience: Audience): string[] {
  if (audience === cat.audience) return cat.targetUsers;
  if (audience === "consumers") return cat.category === "Healthcare" ? ["Patients", "Families"] : ["Local customers", "Families"];
  if (audience === "developers") return ["Developers", "Technical founders"];
  return ["Small businesses", "Team leads"];
}

/** All cue words for a stored category label like "Food & beverage · E-commerce & retail". */
export function categoryTerms(label: string): string[] {
  const names = label.split(" · ").map((c) => c.trim());
  return CATEGORIES.filter((c) => names.includes(c.category)).flatMap((c) => c.terms);
}

/** Who buys: the founder's own words count double against the public pages. */
export function detectAudience(description: string, pagesText: string, fallback: Audience): Audience {
  const d = description.toLowerCase();
  const p = pagesText.toLowerCase();
  const scored = AUDIENCES.map((a) => ({ a, n: count(AUDIENCE_CUES[a], d) * 2 + count(AUDIENCE_CUES[a], p) })).sort((x, y) => y.n - x.n);
  return scored[0].n > 0 && scored[0].n > scored[1].n ? scored[0].a : fallback;
}

/** Ranks categories by whole-word cue hits; the founder's description counts double. */
export function rankCategories(description: string, pagesText: string): { category: MarketCategory; hits: string[]; score: number }[] {
  return CATEGORIES.map((c) => {
    const inDesc = termHits(description, c.terms);
    const inPages = termHits(pagesText, c.terms);
    return { category: c, hits: [...new Set([...inDesc, ...inPages])], score: inDesc.length * 2 + inPages.length };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function pickCategory(description: string, pagesText: string): { primary: MarketCategory; secondary: MarketCategory | null; hits: string[] } {
  const ranked = rankCategories(description, pagesText);
  if (!ranked.length) return { primary: GENERAL, secondary: null, hits: [] };
  const [top, next] = ranked;
  const secondary = next && next.score >= 2 && next.score >= top.score / 2 ? next.category : null;
  return { primary: top.category, secondary, hits: top.hits };
}

/** "…for busy families who want…" → "Busy families". Only the founder's own phrasing. */
export function targetUsersFrom(description: string): string[] {
  const out: string[] = [];
  const re = /\bfor\s+((?:[a-z][a-z'-]*\s+){0,4}?[a-z][a-z'-]*)(?=\s+(?:who|that|to|in|with|and|so|wanting|looking)\b|\s*[,.;:!?)]|\s*$)/gi;
  for (const m of description.matchAll(re)) {
    const phrase = m[1].trim().replace(/\s+/g, " ");
    const first = phrase.split(" ")[0].toLowerCase();
    if (["the", "a", "an", "you", "your", "free", "example", "more", "years", "less", "each", "every", "all", "life", "now", "good", "it", "this", "that", "them"].includes(first)) continue;
    if (phrase.length < 4 || phrase.split(" ").length > 5) continue;
    // "for planning and building…" describes an activity, not a group of people.
    if (/ing$/.test(first)) continue;
    out.push(phrase[0].toUpperCase() + phrase.slice(1).toLowerCase());
  }
  return [...new Set(out)].slice(0, 2);
}

const STOPWORDS = new Set(
  "a an the and or but if then of to in on for with at by from up about into over after is are was were be been being have has had do does did this that these those it its we our you your they their i me my he she his her them as not no so just very can will would should could may might also more most some any all each every than too one two get got how what why when where who which out like via vs use using used make made here there now really without through across around between within while during before after above below under until since per each other another such own same off".split(" "),
);
/** Verbs, filler and praise that make poor search phrases on either side of a bigram. */
const WEAK = new Set(
  "want wants need needs help helps delivered deliver delivers trip busy get gets make makes take takes built build lets let keep keeps start starts find finds love loves try best better great easy simple shop discover explore browse buy order book join meet see offering offer offers offered providing provide provides serving serve serves featuring good perfect beautiful amazing awesome delicious cozy soft warm thoughtful".split(" "),
);
/** Category cues too broad to search for on their own ("food" matches everything). */
const BROAD = new Set("shop food store retail drinks kitchen music video videos game games travel fitness ai api apis security data sales marketing ads healthy organic gifts holiday".split(" "));
/** Site chrome and boilerplate that every website repeats. */
const BOILERPLATE = new Set(
  "home menu cart account login log sign search close open skip content main navigation privacy policy terms conditions cookies cookie newsletter email subscribe contact faq faqs help learn read view click more page pages rights reserved copyright follow instagram facebook twitter tiktok youtube linkedin pinterest gift card cards sale price prices product products collection collections item items size quantity add bag checkout store stores location locations hours company team careers jobs press blog news story stories about welcome shipping returns order orders free today now available select options details review reviews rated star stars back top shop website site online inc llc ltd twin full queen king cali small medium large trial pricing plan plans demo started enable sold out".split(" "),
);
/** Qualifiers: fine in a phrase, but a phrase built on one is less specific. */
const QUALIFIERS = new Set("weekly daily monthly fresh local new online smart modern premium affordable custom personal free fast simple unlimited purpose-built".split(" "));

/** Adjacent content-word pairs that never bridge a stopword or punctuation ("trip to the bakery" yields none). */
function phrases(text: string): string[] {
  const out: string[] = [];
  // Line breaks end a phrase too: headings joined by newlines must not run into each other.
  for (const chunk of text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[\u2010-\u2013]/g, "-").split(/[^a-z0-9 \t'-]+/)) {
    const words = chunk.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const [a, b] = [words[i], words[i + 1]];
      if (STOPWORDS.has(a) || STOPWORDS.has(b) || /^\d+$/.test(a) || /^\d+$/.test(b) || a.length < 3 || b.length < 3) continue;
      out.push(`${a} ${b}`);
    }
  }
  return out;
}

/** Abstract marketing words: frequent on every site, never what anyone searches for. */
const ABSTRACT = new Set(
  "experience experiences expression quality value values name color colour colors option options friends community communities mission vision story world life time times way ways thing things everything something someone designed design made crafted craft classic original special alternative solution solutions platform service services everyday together lightweight powerful beautifully better making work works working year years day days week weeks month months people customers customer business businesses part source began become became grew came went built bring brings brought".split(" "),
);
const contentWord = (w: string) =>
  w.length >= 4 &&
  !STOPWORDS.has(w) &&
  !WEAK.has(w) &&
  !QUALIFIERS.has(w) &&
  !BOILERPLATE.has(w) &&
  !ABSTRACT.has(w) &&
  !BROAD.has(w) &&
  !/\d/.test(w) &&
  // Past tenses ("protected", "designed") describe, they aren't things; codes like "duv-t" aren't words.
  !/[a-z]{4}ed$/.test(w) &&
  w.split("-").every((part) => part.length >= 3);

/**
 * What a site keeps talking about: words and two-word phrases ranked by how often they appear,
 * with titles, descriptions and headings counting three times body text. Brand words, site
 * chrome and filler are skipped, so a bedding shop yields "sheets", "comforters", "pillows".
 */
export function siteTerms(sources: { text: string; weight: number }[], brand: string[] = [], limit = 6): string[] {
  const own = new Set(brand.flatMap((b) => b.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const counts = new Map<string, number>();
  const headline = new Set<string>();
  // Words only ever written Capitalised in running text are names (places, people, brands).
  const lower = new Set<string>();
  const capital = new Set<string>();
  for (const { text, weight } of sources) {
    if (weight >= 3) continue;
    for (const m of text.matchAll(/(?<![.!?]\s)\b([A-Za-z][a-z]{3,})\b/g)) (m[1][0] === m[1][0].toUpperCase() ? capital : lower).add(m[1].toLowerCase());
  }
  const isName = (w: string) => capital.has(w) && !lower.has(w);
  const bump = (k: string, w: number) => {
    counts.set(k, (counts.get(k) ?? 0) + w);
    if (w >= 3) headline.add(k);
  };
  for (const { text, weight } of sources) {
    for (const chunk of text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[\u2010-\u2013]/g, "-").split(/[^a-z \t'-]+/)) {
      const words = chunk.split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, "")).filter(Boolean);
      words.forEach((w, i) => {
        if (!contentWord(w) || own.has(w) || w.includes("'") || isName(w)) return;
        bump(w, weight);
        const next = words[i + 1];
        if (next && contentWord(next) && !own.has(next) && !next.includes("'") && !isName(next)) bump(`${w} ${next}`, weight * 1.5);
      });
    }
  }
  // A term must be in a title, description or heading, or recur heavily in the body.
  const ranked = [...counts.entries()].filter(([k, n]) => (headline.has(k) ? n >= (k.includes(" ") ? 4.5 : 4) : n >= 8)).sort((a, b) => b[1] - a[1]);
  const out: string[] = [];
  for (const [k] of ranked) {
    // Skip a word already covered by a chosen phrase, and a phrase that only repeats a chosen word.
    if (out.some((o) => o.split(" ").includes(k) || (k.includes(" ") && k.split(" ").every((t) => out.includes(t))))) continue;
    // "sheet"/"sheets": keep one form.
    if (out.some((o) => o === `${k}s` || `${o}s` === k)) continue;
    out.push(k);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Search phrases people would actually type about this product. Prefers specific two-word
 * phrases built around the category's own vocabulary, then a local variant if the founder
 * names a place, then what the site itself repeats, then single terms. Broad category
 * language ("food delivery") is only used when the site actually says it.
 */
export function heuristicKeywords(
  description: string,
  headingText: string,
  cat: MarketCategory,
  extraTerms: string[] = [],
  opts: { siteTerms?: string[]; name?: string; corpus?: string } = {},
): string[] {
  const vocab = new Set([...cat.terms, ...extraTerms, ...(opts.siteTerms ?? []).filter((t) => !t.includes(" "))].map((t) => t.toLowerCase()));
  const scored = new Map<string, number>();
  for (const [text, bonus] of [[description, 0.25], [headingText, 0]] as const) {
    for (const p of phrases(text)) {
      const toks = p.split(" ");
      if (toks.some((t) => WEAK.has(t))) continue;
      const termCount = toks.filter((t) => vocab.has(t)).length;
      if (!termCount) continue;
      const score = termCount + bonus - toks.filter((t) => QUALIFIERS.has(t)).length * 0.5;
      scored.set(p, Math.max(scored.get(p) ?? -Infinity, score));
    }
  }
  // The brand is searched for separately; phrases built on its own name ("acme began") add nothing.
  const brand = new Set((opts.name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !vocab.has(w)));
  const bigrams = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .filter((p) => !p.split(" ").some((t) => brand.has(t)));
  const hits = termHits(description, cat.terms).concat(termHits(headingText, cat.terms));
  const singles = hits.filter((t) => !BROAD.has(t));
  // "…homes in Austin" → "<main term> Austin" helps local businesses find nearby conversation.
  const place = cat.audience === "consumers" || cat.category === "Healthcare" ? description.match(/\b(?:in|across|around|near)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/)?.[1] : undefined;
  const isPlace = !!place && !vocab.has(place.toLowerCase()) && !/^(January|February|March|April|May|June|July|August|September|October|November|December|The|Our|My|Your)$/.test(place);
  const local = isPlace && (singles[0] ?? hits[0]) ? [`${singles[0] ?? hits[0]} ${place}`] : [];
  const said = (opts.corpus ?? `${description}\n${headingText}`).toLowerCase();
  const broad = cat.terminology.filter((t) => said.includes(t.toLowerCase())).slice(0, 2);
  const site = opts.siteTerms ?? [];
  return [...new Set([...bigrams.slice(0, 2), ...local, ...site.slice(0, 3), ...bigrams.slice(2, 4), ...singles.slice(0, 3), ...site.slice(3), ...broad].map((k) => k.trim()).filter(Boolean))].slice(0, 10);
}
