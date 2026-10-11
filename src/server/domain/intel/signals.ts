/**
 * Deterministic intent-signal classifier. Each rule is an auditable regex; the matched
 * phrase is kept so the UI can show exactly why a post counted as a signal.
 */

export const SIGNAL_TYPES = [
  "recommendation_request",
  "competitor_usage",
  "complaint",
  "question",
  "launch",
  "initiative",
  "funding",
  "hiring",
  "partnership",
  "migration",
  "tech_adoption",
  "github_activity",
  "mention",
  "x402_enrichment",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_LABEL: Record<SignalType, string> = {
  recommendation_request: "Asked for recommendations",
  competitor_usage: "Uses / evaluates a competitor",
  complaint: "Public pain point",
  question: "Public question",
  launch: "Product launch",
  initiative: "New initiative announced",
  funding: "Funding announcement",
  hiring: "Hiring for relevant roles",
  partnership: "Partnership announcement",
  migration: "Switching providers",
  tech_adoption: "Adopting something relevant",
  github_activity: "Relevant GitHub activity",
  mention: "Relevant mention",
  x402_enrichment: "Verified via purchased data (x402)",
};

/** Buying-intent weight of each signal type (0-40). */
export const INTENT_WEIGHT: Record<SignalType, number> = {
  recommendation_request: 38,
  competitor_usage: 30,
  migration: 28,
  initiative: 26,
  launch: 22,
  complaint: 22,
  hiring: 20,
  funding: 18,
  tech_adoption: 20,
  question: 16,
  partnership: 14,
  github_activity: 12,
  x402_enrichment: 24,
  mention: 6,
};

const RULES: { type: SignalType; re: RegExp }[] = [
  { type: "recommendation_request", re: /\b(any (recommendations?|suggestions?)|recommendations? for|what (do|should) (you|i|we) use|where (can|do|should) (i|we) (get|buy|find)|looking for (a|an|some)\b[^.?!]{0,40}(tool|sdk|api|library|provider|service|app|platform|software|product|brand|shop|store|place|company|agency|vendor|option|alternative)|can (anyone|someone|you all) recommend|best [a-z]+ (in|near|for)\b|alternatives? to)\b/i },
  { type: "migration", re: /\b(migrat(e|ed|ing)|moving (from|to)|switch(ed|ing)? (from|to)|port(ed|ing) (our|to)|replac(e|ed|ing) (our|my)|cancel(l?ed|l?ing)? (my|our))\b/i },
  { type: "funding", re: /\b(raised|raises|seed round|series [abc]|pre-seed|funding round|backed by)\b/i },
  { type: "hiring", re: /\b(we'?re hiring|now hiring|is hiring|join (our|the) team|open roles?|job opening|looking to hire|hiring (a|an))\b/i },
  { type: "launch", re: /\b(launch(ed|ing)?|just shipped|now live|now open|grand opening|introducing|announcing|released|unveil(s|ed)?|debut(s|ed)?|v\d+\.\d+)\b/i },
  { type: "initiative", re: /\b(we('re| are) (building|exploring|working on|planning)|new initiative|roadmap|pilot(ing)?|rolling out|expand(s|ing)? (to|into)|opening (a|our) (new|second))\b/i },
  { type: "partnership", re: /\b(partner(ed|ing|ship)? with|integrat(ion|ed) with|teamed up)\b/i },
  { type: "complaint", re: /\b(frustrat|annoying|painful|broken|doesn'?t work|struggl|nightmare|hate (that|how)|why is it so hard|disappoint|never (arrived|showed up)|terrible service|so expensive|overpriced)\w*/i },
  { type: "question", re: /(\?\s*$|\bhow (do|can|to)\b|\bis there (a|an|any)\b|\bdoes anyone know\b)/im },
  { type: "tech_adoption", re: /\b(using|adopt(ed|ing)|integrat(ing|ed)|built (on|with)|implement(ed|ing)|signed up for|subscribed to|started using)\b/i },
];

export interface ClassifiedSignal {
  type: SignalType;
  matched: string;
}

/**
 * Classify a post. Returns every matched signal type (deduped), strongest first.
 * `competitors` lets "using <competitor>" become competitor_usage.
 */
export function classifySignals(text: string, opts: { competitors?: string[]; provider?: string } = {}): ClassifiedSignal[] {
  const found = new Map<SignalType, string>();
  for (const { type, re } of RULES) {
    const m = text.match(re);
    if (m) found.set(type, m[0].trim());
  }
  for (const c of opts.competitors ?? []) {
    if (!c || c.length < 3) continue;
    const re = new RegExp(`\\b(using|use|tried|switch(ed|ing)? (from|to)|evaluat\\w+|vs\\.?|versus|compared to)\\b[^.!?]{0,30}\\b${escapeRe(c)}\\b`, "i");
    const m = text.match(re);
    if (m) found.set("competitor_usage", m[0].trim());
  }
  if (opts.provider === "github" && !found.size) found.set("github_activity", "GitHub repository activity");
  if (!found.size) found.set("mention", "");
  return [...found.entries()]
    .map(([type, matched]) => ({ type, matched }))
    .sort((a, b) => INTENT_WEIGHT[b.type] - INTENT_WEIGHT[a.type]);
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-term match for keywords like "x402" or "agent payments". */
export function termHits(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return [...new Set(terms.filter((t) => t && new RegExp(`(^|[^a-z0-9])${escapeRe(t.toLowerCase())}([^a-z0-9]|$)`).test(lower)))];
}
