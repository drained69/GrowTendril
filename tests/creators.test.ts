import { describe, it, expect } from "vitest";
import { keyPageLinks, namedCompetitors, normalizeUrl, siteFacts, socialProfiles } from "../src/server/domain/intel/site";
import type { PageText } from "../src/server/domain/intel/crawl";
import { contactRoutes, emailsIn, linksIn } from "../src/server/domain/growth/creator-contacts";
import { greetingName, offTopicField, outreachDraft, reportCsv, reportMarkdown, tierFor, type CreatorReport } from "../src/server/domain/growth/creator-report";
import { mapBskyActor } from "../src/server/integrations/providers/bluesky";
import { stripHtml } from "../src/server/integrations/providers/http";
import { siteTerms } from "../src/server/domain/intel/market-taxonomy";
import { evaluatePolicy, DEFAULT_POLICY } from "../src/server/domain/agent/policy";
import { parseFinancialAction } from "../src/server/domain/agent/actions";
import { policyValues } from "../src/server/domain/workspace/setup";
import { toMicro } from "../src/lib/money";

const home: PageText = {
  url: "https://www.crumbclub.com/",
  ok: true,
  title: "Crumb Club — Fresh sourdough delivered | Austin",
  description: "Weekly sourdough bread delivered to homes in Austin.",
  headings: ["Fresh bread, every week", "How it works"],
  text: "Crumb Club bakes sourdough every morning. A better alternative to Panera for busy families.",
  links: [
    "https://www.crumbclub.com/about",
    "https://www.crumbclub.com/pricing/",
    "https://www.crumbclub.com/blog/2024/01/post",
    "https://www.crumbclub.com/vs/panera",
    "https://instagram.com/crumbclub",
    "https://twitter.com/crumbclub",
    "https://twitter.com/intent/tweet?text=hi",
    "https://other.com/about",
  ],
  jsonLd: [{ "@type": "Bakery", name: "Crumb Club", address: { addressLocality: "Austin", addressRegion: "TX" }, sameAs: ["https://www.tiktok.com/@crumbclub"] }],
};

describe("reading a website", () => {
  it("normalises bare domains", () => {
    expect(normalizeUrl("crumbclub.com")).toBe("https://crumbclub.com/");
    expect(() => normalizeUrl("localhost")).toThrow();
  });
  it("follows only same-site explanatory pages", () => {
    expect(keyPageLinks(home)).toEqual(["https://www.crumbclub.com/about", "https://www.crumbclub.com/pricing"]);
  });
  it("extracts name, location, socials and named competitors", () => {
    const f = siteFacts(home, [home]);
    expect(f.name).toBe("Crumb Club");
    expect(f.location).toBe("Austin, TX");
    expect(f.socials).toMatchObject({ x: "crumbclub", instagram: "crumbclub", tiktok: "crumbclub" });
    expect(f.competitors).toContain("Panera");
    expect(f.description).toMatch(/sourdough/);
  });
  it("falls back to the title or domain for the name", () => {
    expect(siteFacts({ ...home, jsonLd: [], siteName: undefined }, []).name).toBe("Crumb Club");
    expect(siteFacts({ ...home, url: "https://loaflabs.io/", jsonLd: [], title: "Home" }, []).name).toBe("Loaflabs");
  });
  it("decodes entities so titles split cleanly", () => {
    expect(stripHtml("Tartine Bakery &#8211; Good food &amp; warm rooms &rsquo;n&#x2019; more")).toBe("Tartine Bakery – Good food & warm rooms ’n’ more");
    const t = { ...home, title: stripHtml("Tartine Bakery &#8211; Tartine is a thoughtful expression of modern craft."), description: undefined, jsonLd: [], headings: ["Home", "Welcome to Tartine"] };
    expect(siteFacts(t, [t]).name).toBe("Tartine Bakery");
    expect(siteFacts(t, [t]).description).toBe("Tartine is a thoughtful expression of modern craft.");
  });
  it("reads a postal address when there is no structured data", () => {
    expect(siteFacts({ ...home, jsonLd: [], text: "Visit us at 600 Guerrero St, San Francisco, CA 94110." }, []).location).toBe("San Francisco, CA");
  });
  it("finds what the site keeps talking about, minus chrome, names and codes", () => {
    const terms = siteTerms(
      [
        { text: "Luxury bedding\nSheets\nComforters\nPillows\nSign in\nCart", weight: 3 },
        { text: "Our sheets are soft. Shop sheets, comforters and pillows. Sizes: twin, queen, king. SKU duv-t. Visit Inner Sunset. Inner Sunset store. Inner Sunset hours. Sheets sheets comforters pillows.", weight: 1 },
      ],
      ["Brooklinen"],
    );
    expect(terms).toEqual(expect.arrayContaining(["sheets", "comforters", "pillows"]));
    expect(terms.join(" ")).not.toMatch(/twin|king|duv|inner|sunset|sign|cart|brooklinen/);
  });
  it("ignores share links", () => {
    expect(socialProfiles(["https://twitter.com/share", "https://x.com/intent/post"])).toEqual({});
    expect(namedCompetitors([{ ...home, links: [], text: "" }], "Crumb Club")).toEqual([]);
  });
});

describe("creator contact routes", () => {
  it("finds emails and links people publish in their bio", () => {
    const bio = "Sourdough nerd 🍞 Collabs: hello@baker.co · shop: bakerbakes.com · ig instagram.com/baker · @friend.bsky.social";
    expect(emailsIn(bio)).toEqual(["hello@baker.co"]);
    expect(linksIn(bio)).toEqual(["https://bakerbakes.com", "https://instagram.com/baker"]);
    const routes = contactRoutes("bluesky", mapBskyActor({ did: "d", handle: "baker.bsky.social", displayName: "Sam Baker", description: bio }));
    expect(routes.map((r) => r.kind)).toEqual(["email", "website", "social", "profile"]);
    expect(routes.at(-1)?.href).toBe("https://bsky.app/profile/baker.bsky.social");
  });
});

describe("influencer report", () => {
  it("tiers by score, authenticity and recent activity", () => {
    expect(tierFor({ overall: 72, authenticity: 80, daysSinceActive: 3 })).toBe("Contact first");
    expect(tierFor({ overall: 72, authenticity: 40, daysSinceActive: 3 })).toBe("Worth a test");
    expect(tierFor({ overall: 72, authenticity: 80, daysSinceActive: 40 })).toBe("Worth a test");
    expect(tierFor({ overall: 30, authenticity: 90, daysSinceActive: 1 })).toBe("Watch");
  });
  it("greets people by first name and organisations as a team", () => {
    expect(greetingName("Sam Baker 🍞", "sam")).toBe("Sam");
    expect(greetingName("The Witch's Bakery - Sunny Lab", "sunnylab")).toBe("The Witch's Bakery team");
    expect(greetingName("🍞🍞", "loaf")).toBe("@loaf");
  });
  it("flags creators whose profile belongs to another field", () => {
    const bio = "The Witch's Bakery - Sunny Lab. #indiegame studio telling the story of a witch opening a bakery. Wishlist on Steam #indiedev";
    expect(offTopicField(bio, "Food & beverage")).toBe("Games & entertainment");
    expect(offTopicField("Home baker. Sourdough, pastries and cakes every weekend.", "Food & beverage")).toBeNull();
    expect(offTopicField("I review indie games on Steam", "Games & entertainment · Media, creators & community")).toBeNull();
    expect(tierFor({ overall: 80, authenticity: 90, daysSinceActive: 1, offTopic: true })).toBe("Watch");
  });
  it("writes a personal, disclosed first message", () => {
    const d = outreachDraft({ name: "Sam Baker 🍞", handle: "sam", provider: "bluesky", topic: "sourdough", excerpt: "My 72-hour sourdough finally worked. Here's the crumb." }, { product: "Crumb Club", summary: "Weekly sourdough delivered in Austin. More details here.", angle: "a honest taste test", budget: "50 USDC" });
    expect(d.startsWith("Hi Sam,")).toBe(true);
    expect(d).toContain("Bluesky posts about sourdough");
    expect(d).toContain("clearly marked as sponsored");
    expect(d).toContain("budget around 50 USDC");
    expect(d.trim().endsWith("[Your name]")).toBe(true);
  });
  it("exports Markdown and CSV", () => {
    const r: CreatorReport = {
      generatedAt: new Date(0).toISOString(),
      generatedBy: "template",
      product: "Crumb Club",
      category: "Food & beverage",
      keywords: ["sourdough"],
      totals: { creators: 1, contactFirst: 1, withPublicContact: 1, platforms: { Bluesky: 1 } },
      topTopics: ["sourdough"],
      method: ["Scored on what they publish."],
      entries: [
        {
          kolId: "k1", rank: 1, tier: "Contact first", name: "Sam", handle: "sam", provider: "bluesky", platform: "Bluesky", profileUrl: "https://bsky.app/profile/sam", followers: 1200, bio: null, overall: 74,
          scores: [], topics: ["sourdough"], postsRead: 10, relevantPosts: 7, avgEngagement: 40, lastActive: null, recentPosts: [], estimatedCostMicro: toMicro(75), mentionsUs: false, competitorsCovered: [],
          contacts: [{ kind: "email", label: "Email", value: "sam@x.co", href: "mailto:sam@x.co", note: "Listed on their Bluesky profile" }],
          whyContact: ["7 of 10 posts are about sourdough"], risks: ["None"], approach: "One post.", analysis: "Sam bakes.", outreachDraft: 'Hi Sam,\nSay "hi"', opportunityId: null,
        },
      ],
    };
    const md = reportMarkdown(r);
    expect(md).toContain("## 1. Sam (@sam) — Contact first");
    expect(md).toContain("> Hi Sam,");
    const csv = reportCsv(r).split("\n");
    expect(csv[0]).toMatch(/^"rank","tier"/);
    expect(csv[1]).toContain('"sam@x.co"');
    expect(csv[1]).toContain('"Hi Sam, Say ""hi"""');
  });
});

describe("autonomous spending within founder limits", () => {
  const state = { walletConfigured: true, walletFrozen: false, spentTodayMicro: 0, missionBudgetMicro: toMicro(500), missionCommittedMicro: 0, missionActive: true, categoryAllocatedMicro: toMicro(20), categoryCommittedMicro: 0, serviceKnown: true };
  const purchase = (amount: string) =>
    parseFinancialAction({ action: "purchase_service", serviceId: "svc_1", resourceUrl: "https://data.example/api", amount, currency: "USDC", chain: "Arc", reasonCode: "VERIFY_CUSTOMER_INTENT", expectedValue: "medium", missionId: "m1", confidence: 0.7, subject: { type: "company", id: "c1" } }).data!;

  it("lets the agent buy research on its own only after the founder opts in", () => {
    expect(evaluatePolicy(purchase("0.5"), DEFAULT_POLICY, state).verdict).toBe("APPROVAL_REQUIRED");
    const opted = policyValues({ dailySpend: "10", hardCeiling: "10", autonomousLimit: "2" });
    expect(evaluatePolicy(purchase("0.5"), opted, state).verdict).toBe("ALLOW");
    expect(evaluatePolicy(purchase("3"), opted, state).verdict).toBe("APPROVAL_REQUIRED");
    expect(evaluatePolicy(purchase("0.5"), opted, { ...state, spentTodayMicro: toMicro(9.8) }).verdict).toBe("APPROVAL_REQUIRED");
  });
  it("never lets the agent pay a person on its own", () => {
    const opted = policyValues({ dailySpend: "10", hardCeiling: "10", autonomousLimit: "10" });
    const pay = parseFinancialAction({ action: "send_payment", purpose: "kol_payment", recipient: "0x1111111111111111111111111111111111111111", amount: "1", currency: "USDC", chain: "Arc", experimentId: "e1", reasonCode: "PAY_CREATOR", expectedValue: "high", missionId: "m1", confidence: 0.9 }).data!;
    expect(evaluatePolicy(pay, opted, { ...state, categoryAllocatedMicro: toMicro(100) }).verdict).toBe("APPROVAL_REQUIRED");
  });
  it("caps the autonomous limit at the ceiling", () => {
    expect(policyValues({ dailySpend: "10", hardCeiling: "5", autonomousLimit: "50" }).maxTransactionMicro).toBe(toMicro(5));
    expect(policyValues({ dailySpend: "10", hardCeiling: "10", autonomousLimit: "0" }).autonomyEnabled).toBe(false);
  });
});
