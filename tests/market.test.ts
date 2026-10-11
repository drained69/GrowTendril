import { describe, it, expect, beforeAll, vi } from "vitest";
import { classifySignals } from "../src/server/domain/intel/signals";
import { analyzeMention } from "../src/server/domain/intel/mentions";
import { companyFromHeadline } from "../src/server/domain/intel/entities";
import { detectAudience, pickCategory, targetUsersFrom } from "../src/server/domain/intel/market-taxonomy";
import { mapBskyPost } from "../src/server/integrations/providers/bluesky";
import { templatesFor } from "../src/lib/missions";

// The analyst must fall back to deterministic logic in tests, never call a model.
vi.mock("@/server/integrations/llm", () => ({ aiEnabled: () => false, aiName: () => "AI", aiStructured: async () => ({ data: null, error: "AI disabled in tests" }) }));

let analyst: typeof import("../src/server/domain/intel/product-analyst");
beforeAll(async () => {
  analyst = await import("../src/server/domain/intel/product-analyst");
});

const BAKERY = "Weekly sourdough bread subscription delivered to homes in Austin. For busy families who want fresh, local bread and pastries without a trip to the bakery.";

describe("product analyst without Claude", () => {
  it("profiles a local consumer business in its own terms", async () => {
    const r = await analyst.analyzeProduct({ name: "Crumb Club", description: BAKERY });
    expect(r.generatedBy).toBe("heuristic");
    expect(r.profile.category).toMatch(/^Food & beverage/);
    expect(r.profile.audience).toBe("consumers");
    expect(r.profile.targetUsers[0]).toBe("Busy families");
    expect(r.profile.keywords).toContain("sourdough bread");
    expect(r.profile.keywords).toContain("bakery Austin");
    expect(r.profile.keywords.join(" ")).not.toMatch(/sdk|api|developer/i);
    // Broad category language the founder never used isn't a search keyword.
    expect(r.profile.keywords).not.toContain("food delivery");
    expect(r.profile.keywords).not.toContain("food");
  });

  it("still recognises developer tools", async () => {
    const r = await analyst.analyzeProduct({ name: "Meterline", description: "Usage-based billing API and SDK for developer tools." });
    expect(r.profile.category).toMatch(/^Developer tools/);
    expect(r.profile.audience).toBe("developers");
  });

  it("recognises B2B software and honours the founder's audience choice", async () => {
    const b2b = await analyst.analyzeProduct({ name: "ChairTime", description: "Scheduling software for dental clinics to reduce no-shows." });
    expect(b2b.profile.category).toMatch(/^Healthcare/);
    expect(b2b.profile.audience).toBe("businesses");
    const forced = await analyst.analyzeProduct({ name: "Crumb Club", description: BAKERY, audience: "businesses" });
    expect(forced.profile.audience).toBe("businesses");
  });

  it("proposes people, not companies or developers, as consumer ICPs", async () => {
    const { profile } = await analyst.analyzeProduct({ name: "Crumb Club", description: BAKERY });
    const { icps } = await analyst.proposeIcp(profile, "Crumb Club");
    expect(icps[0].tier).toBe("primary");
    expect(icps[0].companySize).toBeNull();
    expect(icps.map((i) => i.title).join(" ")).not.toMatch(/developer|web3/i);
  });
});

describe("market taxonomy", () => {
  it("detects the audience from the founder's words", () => {
    expect(detectAudience("An app that helps parents plan family meals", "", "businesses")).toBe("consumers");
    expect(detectAudience("Invoicing for agencies and small businesses", "", "consumers")).toBe("businesses");
    expect(detectAudience("A tool", "", "developers")).toBe("developers");
  });
  it("does not join separate headings into one phrase", async () => {
    const pages = [{ url: "https://x.example/", ok: true, title: "X", headings: ["SPECIAL ORDER CAKES", "PRE ORDER CAKES & TARTS"], text: "" }];
    const r = await analyst.analyzeProduct({ name: "X Bakery", description: "A neighbourhood bakery with cakes and tarts." }, { pages });
    expect(r.profile.keywords).not.toContain("cakes pre");
  });
  it("reads activities as activities, not customers", () => {
    expect(targetUsersFrom("Purpose-built for planning and building products.")).toEqual([]);
  });
  it("falls back to a general category instead of developer tooling", () => {
    expect(pickCategory("Handmade candles shipped worldwide", "").primary.category).not.toBe("Developer tools");
    expect(pickCategory("zzz qqq", "").primary.category).toBe("General product");
  });
  it("extracts who it's for", () => {
    expect(targetUsersFrom("Meal plans for new parents who are short on time")).toEqual(["New parents"]);
    expect(targetUsersFrom("Free for the first month")).toEqual([]);
  });
});

describe("company extraction from headlines", () => {
  it.each([
    ["Acme raises $5M to deliver bread nationwide", "Acme"],
    ["Crumb & Co. launches a sourdough club in Austin", "Crumb & Co"],
    ["Austin-based Loaf Labs, the bread startup, secures seed round", "Loaf Labs"],
    ["Show HN: Meterline – usage billing for APIs", "Meterline"],
  ])("%s → %s", (headline, name) => {
    expect(companyFromHeadline(headline)).toBe(name);
  });
  it.each(["I launched my bakery today", "Local Bakery opens downtown", "This app raises questions", "Google launches a new AI model", "just some post about bread"])("ignores %s", (text) => {
    expect(companyFromHeadline(text)).toBeUndefined();
  });
});

describe("signals and feedback for any market", () => {
  it("treats consumer requests as recommendation requests", () => {
    expect(classifySignals("Can anyone recommend a good bakery in Austin?")[0].type).toBe("recommendation_request");
    expect(classifySignals("Looking for a skincare brand that works for sensitive skin")[0].type).toBe("recommendation_request");
  });
  it("clusters delivery and support complaints", () => {
    expect(analyzeMention("My order never arrived and the delivery tracking is broken").issueKey).toBe("delivery");
    expect(analyzeMention("Terrible customer service, they never replied to my email").issueKey).toBe("support");
  });
});

describe("Bluesky mapping", () => {
  it("builds a public post URL and engagement", () => {
    const post = mapBskyPost(
      { uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", author: { did: "did:plc:abc", handle: "baker.bsky.social", displayName: "Baker" }, record: { text: "Fresh sourdough today", createdAt: "2026-10-04T10:00:00Z" }, indexedAt: "2026-10-04T10:00:01Z", likeCount: 4, replyCount: 2, repostCount: 1, quoteCount: 1 },
      120,
    );
    expect(post.url).toBe("https://bsky.app/profile/baker.bsky.social/post/3kxyz");
    expect(post.engagement).toEqual({ likes: 4, comments: 2, shares: 2 });
    expect(post.authorFollowers).toBe(120);
  });
});

describe("Reddit public search feed", () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/bakery_team</name></author><content type="html">&lt;div&gt;A community for bakers&lt;/div&gt;</content><id>t5_abc</id><link href="https://www.reddit.com/r/Breadit/" /><updated>2024-01-01T00:00:00+00:00</updated><title>Breadit</title></entry>
<entry><author><name>/u/crumbfan</name><uri>https://www.reddit.com/user/crumbfan</uri></author><category term="Breadit" label="r/Breadit"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Where can I find a bakery that&amp;#39;s open early?&lt;/p&gt;&lt;/div&gt; submitted by &lt;a href=&quot;https://www.reddit.com/user/crumbfan&quot;&gt; /u/crumbfan &lt;/a&gt; &lt;span&gt;[link]&lt;/span&gt;</content><id>t3_1abcde</id><link href="https://www.reddit.com/r/Breadit/comments/1abcde/early_bakery/" /><updated>2026-10-05T08:00:00+00:00</updated><published>2026-10-05T08:00:00+00:00</published><title>Early bakery &amp; coffee?</title></entry>
</feed>`;

  it("keeps posts, skips subreddits, and decodes the escaped body", async () => {
    const { parseRedditFeed } = await import("../src/server/integrations/providers/reddit");
    const posts = parseRedditFeed(feed);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      externalId: "1abcde",
      url: "https://www.reddit.com/r/Breadit/comments/1abcde/early_bakery/",
      authorHandle: "crumbfan",
      title: "r/Breadit: Early bakery & coffee?",
    });
    expect(posts[0].content).toBe("Early bakery & coffee?\nWhere can I find a bakery that's open early?");
    expect(posts[0].publishedAt.toISOString()).toBe("2026-10-05T08:00:00.000Z");
  });

  it("runs without keys but rejects half a key pair", async () => {
    const { reddit } = await import("../src/server/integrations/providers/reddit");
    expect(reddit.isReady({})).toBe(true);
    expect(reddit.combineQueries?.({})).toBe(true);
    expect(reddit.isReady({ clientId: "id" })).toBe(false);
    expect(reddit.combineQueries?.({ clientId: "id", clientSecret: "s" })).toBe(false);
  });
});

describe("mission templates", () => {
  it("offers templates that fit the audience", () => {
    const consumer = templatesFor("consumers").map((t) => t.key);
    expect(consumer).not.toContain("first_100_devs");
    // Service businesses count bookings first; a shop or bakery counts purchases first.
    expect(templatesFor("consumers", "Healthcare")[0].key).toBe("first_bookings");
    expect(templatesFor("consumers", "Food & beverage")[0].key).not.toBe("first_bookings");
    expect(consumer).not.toContain("find_buyers");
    expect(consumer[0]).toBe("first_customers");
    expect(templatesFor("developers")[0].key).toBe("first_100_devs");
    expect(templatesFor("businesses")[0].key).toBe("find_buyers");
  });
});
