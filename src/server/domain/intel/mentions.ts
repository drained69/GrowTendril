import { DAY_MS } from "@/lib/time";
import { escapeRe } from "@/server/domain/intel/signals";

/**
 * Product-mention analysis. Sentiment alone is not useful; we extract *what kind* of
 * feedback it is, and cluster recurring issues so GrowTendril can say "fix this before
 * buying more traffic".
 */

export type MentionCategory =
  | "feature_request"
  | "complaint"
  | "praise"
  | "competitor_comparison"
  | "question"
  | "purchase_intent"
  | "churn_risk"
  | "confusion"
  | "integration_request";

const CAT_RULES: { cat: MentionCategory; re: RegExp }[] = [
  { cat: "feature_request", re: /\b(would love|wish (it|they)|please add|feature request|it would be (great|nice)|support for|can you add)\b/i },
  { cat: "complaint", re: /\b(broken|bug|doesn'?t work|failing|fails|frustrat\w*|annoying|painful|slow|terrible|awful|worst)\b/i },
  { cat: "praise", re: /\b(love|amazing|awesome|great|excellent|impressed|game.?changer|so easy|just works)\b/i },
  { cat: "competitor_comparison", re: /\b(vs\.?|versus|compared to|better than|worse than|instead of|alternative to)\b/i },
  { cat: "question", re: /(\?|\bhow (do|can|to)\b|\bdoes it\b)/i },
  { cat: "purchase_intent", re: /\b(pricing|how much|paid plan|upgrade|buy|order(ing)?|book(ing)?|subscribe|enterprise plan|trial|where can i get)\b/i },
  { cat: "churn_risk", re: /\b(switching (away|from)|moving off|cancel+(ed|ing)?|unsubscrib\w*|giving up on|stopped using|leaving|never (ordering|buying|using) again)\b/i },
  { cat: "confusion", re: /\b(confus\w*|unclear|don'?t understand|no idea how|docs (are|were) (bad|unclear|missing)|where is)\b/i },
  { cat: "integration_request", re: /\b(integrat\w* with|plugin for|connect(s|ion)? (to|with)|works? with my|sync(s|ing)? with)\b/i },
];

const POS = /\b(love|great|amazing|awesome|excellent|easy|fast|impressed|works|smooth|helpful|clean)\b/gi;
const NEG = /\b(broken|bug|fail\w*|slow|confus\w*|annoying|painful|terrible|hate|awful|frustrat\w*|worst|stuck|unclear|friction)\b/gi;

export function sentimentOf(text: string): "positive" | "negative" | "neutral" {
  const p = text.match(POS)?.length ?? 0;
  const n = text.match(NEG)?.length ?? 0;
  if (n > p) return "negative";
  if (p > n) return "positive";
  return "neutral";
}

/** Recurring issue themes. Keys are stable so week-over-week changes are comparable. */
export const ISSUE_THEMES: { key: string; label: string; re: RegExp; segment: string }[] = [
  { key: "wallet-onboarding", label: "Signup & onboarding friction", re: /\b(sign ?up|signing up|onboarding|getting started|set ?up|setup|account creation|verify my|verification|wallet (setup|onboarding|creation|connect)|connect(ing)? (a |my )?wallet|seed phrase)\b/i, segment: "New users" },
  { key: "docs-gaps", label: "Unclear instructions or docs", re: /\b(docs?|documentation|instructions|manual|example|tutorial|quickstart|how[- ]to guide)\b/i, segment: "Users" },
  { key: "auth-keys", label: "Login & account access", re: /\b(log ?in|logged out|password|locked out|api key|auth(entication)?|401|403|token expired|credentials?)\b/i, segment: "Users" },
  { key: "latency", label: "Speed & reliability", re: /\b(slow|latency|timeout|timed out|performance|outage|down again|crash(es|ed|ing)?|keeps? crashing)\b/i, segment: "All users" },
  { key: "pricing-clarity", label: "Pricing & billing", re: /\b(pricing|price|cost|fees?|expensive|overpriced|charged|refund|billing|invoice)\b/i, segment: "Buyers" },
  { key: "delivery", label: "Delivery & fulfillment", re: /\b(delivery|delivered late|late delivery|shipping|shipped|never arrived|didn'?t arrive|lost package|tracking number|out of stock)\b/i, segment: "Customers" },
  { key: "support", label: "Customer support", re: /\b(customer (service|support)|support team|no response|never (replied|responded)|can'?t reach|no one answers|waited (hours|days))\b/i, segment: "Customers" },
  { key: "quality", label: "Product quality", re: /\b(quality|stale|damaged|defective|broke after|cheap(ly)? made|tastes?|smell|wrong (item|order|size))\b/i, segment: "Customers" },
  { key: "chain-support", label: "Platform & device support", re: /\b(support (for )?(android|ios|iphone|windows|mac|linux|base|solana|arbitrum|polygon)|not available (on|in)|testnet|mainnet|chain support)\b/i, segment: "Users" },
];

export interface MentionAnalysis {
  sentiment: "positive" | "negative" | "neutral";
  categories: MentionCategory[];
  issueKey: string | null;
  competitor: string | null;
  churnRisk: boolean;
  purchaseIntent: boolean;
}

export function analyzeMention(text: string, competitors: string[] = []): MentionAnalysis {
  const categories = CAT_RULES.filter((r) => r.re.test(text)).map((r) => r.cat);
  const sentiment = sentimentOf(text);
  const competitor = competitors.find((c) => c.length > 2 && new RegExp(`\\b${escapeRe(c)}\\b`, "i").test(text)) ?? null;
  if (competitor && !categories.includes("competitor_comparison")) categories.push("competitor_comparison");
  const negativeish = sentiment === "negative" || categories.includes("complaint") || categories.includes("confusion");
  const issue = negativeish ? ISSUE_THEMES.find((t) => t.re.test(text)) : undefined;
  return {
    sentiment,
    categories,
    issueKey: issue?.key ?? null,
    competitor,
    churnRisk: categories.includes("churn_risk"),
    purchaseIntent: categories.includes("purchase_intent"),
  };
}

export interface IssueCluster {
  key: string;
  label: string;
  segment: string;
  mentions7d: number;
  mentionsPrev7d: number;
  changePct: number;
  blocksAcquisition: boolean;
  recommendation: string;
}

/**
 * An issue "blocks acquisition" when it is growing fast and frequent enough that paying for
 * more traffic would mostly pay to show new users the same friction.
 */
export function clusterIssues(mentions: { issueKey: string | null; publishedAt: Date }[], now = Date.now()): IssueCluster[] {
  return ISSUE_THEMES.map((t) => {
    const ms = mentions.filter((m) => m.issueKey === t.key);
    const v7 = ms.filter((m) => now - m.publishedAt.getTime() <= 7 * DAY_MS).length;
    const prev = ms.filter((m) => {
      const age = now - m.publishedAt.getTime();
      return age > 7 * DAY_MS && age <= 14 * DAY_MS;
    }).length;
    const changePct = prev ? Math.round(((v7 - prev) / prev) * 100) : v7 ? 100 : 0;
    const blocks = v7 >= 5 && changePct >= 50;
    return {
      key: t.key,
      label: t.label,
      segment: t.segment,
      mentions7d: v7,
      mentionsPrev7d: prev,
      changePct,
      blocksAcquisition: blocks,
      recommendation: blocks
        ? `Investigate ${t.label.toLowerCase()} before increasing acquisition spend — new users will hit the same friction.`
        : v7
          ? `Monitor ${t.label.toLowerCase()}; route examples to the product team.`
          : "",
    };
  }).filter((c) => c.mentions7d + c.mentionsPrev7d > 0);
}
