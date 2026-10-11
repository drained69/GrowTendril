/**
 * Conservative company extraction from headline-style text ("Acme raises $5M…",
 * "Show HN: Acme – …"). Only the subject of a business-event verb counts, so ordinary
 * posts ("I launched…", "This app raises questions") do not create companies.
 */

const EVENT_VERBS =
  "raises|raised|secures|secured|closes|launches|launched|announces|announced|unveils|unveiled|introduces|debuts|opens|expands|acquires|acquired|partners with|teams up with|is hiring|hires|rolls out|releases|adds|lands|wins";

const SUBJECT = "((?:[A-Z][\\w&'.-]*|[0-9][\\w&'.-]*[A-Za-z][\\w&'.-]*)(?:\\s+(?:[A-Z][\\w&'.-]*|&|of|and)){0,3})";
const HEADLINE = new RegExp(`^\\s*(?:(?:Show|Launch) HN:\\s*)?${SUBJECT}\\s*(?:,[^,]{1,60},\\s*)?(?:${EVENT_VERBS})\\b`);
const SHOW_HN = /^(?:Show|Launch) HN:\s*([A-Z0-9][\w.&-]{1,30})\b/;

/** Leading words that are never a company name on their own. */
const NOT_A_NAME = new Set(
  "I We You They He She It This That These Those Our My Your Their His Her The A An New Today Just How Why What When Where Who Report Breaking Update Exclusive Watch Video Opinion Analysis Here There Someone Everyone Nobody Company Startup Firm Brand Team Government City State Police Study Survey Apple Google Amazon Microsoft Meta".split(" "),
);

/** "Local Bakery opens…" describes a business without naming it. */
const DESCRIPTIVE = new Set("Local Small Popular Family Neighborhood Beloved Famous Another One Two Three Downtown Indie Independent Startup".split(" "));

export function companyFromHeadline(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const line = text.split(/\n/)[0].slice(0, 200);
  const hn = line.match(SHOW_HN)?.[1];
  if (hn && !NOT_A_NAME.has(hn)) return hn;
  const m = line.match(HEADLINE);
  if (!m) return undefined;
  const words = m[1].replace(/[.,'-]+$/, "").trim().split(/\s+/);
  if (/-based$/i.test(words[0])) words.shift();
  const name = words.join(" ");
  if (!words.length || NOT_A_NAME.has(words[0]) || DESCRIPTIVE.has(words[0]) || name.length < 2 || name.length > 40) return undefined;
  return name;
}
