import { describe, expect, it } from "vitest";
import { parseMeta, parsePage, supportingLinks } from "@/server/domain/intel/crawl";
import { decodeEntities, stripHtml } from "@/server/integrations/providers/http";
import { decodeBody } from "@/server/security/safe-fetch";
import { detectLocation, tldCountry, toCountryCode } from "@/server/domain/intel/location";
import { groundProfile } from "@/server/domain/intel/product-analyst";
import { siteNamedCompetitors, syncCompetitorDetails, verifyCandidate } from "@/server/domain/intel/competitors";
import type { PageText } from "@/server/domain/intel/crawl";

const LAGOS_BAKERY = `<!doctype html><html lang="en-NG"><head>
<title>Mama&#8217;s Bakery &amp; Caf&eacute; &mdash; Lekki</title>
<meta content="Fresh bread &amp; cakes delivered across Lagos." name="description">
<meta property="og:locale" content="en_NG">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Bakery","name":"Mama's Bakery","address":{"@type":"PostalAddress","addressLocality":"Lagos","addressRegion":"Lagos State","addressCountry":"NG"},"priceRange":"₦₦"}]}</script>
<script>window.track = "ignore me";</script>
</head><body><h1>Fresh bread, every morning</h1><p>Order on +234 803 000 0000. Loaves from ₦1,500.</p>
<a href="/about-us">About us</a><a href="/contact">Contact</a><a href="/menu">Our menu</a><a href="https://instagram.com/x">IG</a>
<a href="/compare/sweet-sensation">vs Sweet Sensation</a></body></html>`;

const page = (url: string, html: string) => parsePage(url, html);

describe("page parsing", () => {
  it("reads meta tags regardless of attribute order and decodes entities", () => {
    const m = parseMeta(`<meta content="A &amp; B" name="description"><meta name='keywords' content='x'>`);
    expect(m.description).toBe("A & B");
    expect(m.keywords).toBe("x");
    expect(decodeEntities("&#8217;&#x2019;&eacute;&Uuml;&ntilde;&unknown;")).toBe("’’éÜñ&unknown;");
  });

  it("strips scripts and keeps readable text", () => {
    const p = page("https://mamasbakery.ng/", LAGOS_BAKERY);
    expect(p.title).toBe("Mama’s Bakery & Café — Lekki");
    expect(p.description).toBe("Fresh bread & cakes delivered across Lagos.");
    expect(p.text).not.toContain("ignore me");
    expect(p.headings).toEqual(["Fresh bread, every morning"]);
    expect(p.jsonLd?.[0]?.["@type"]).toBe("Bakery");
    expect(p.lang).toBe("en-NG");
  });

  it("follows only same-site about / contact / pricing links", () => {
    const links = supportingLinks(page("https://mamasbakery.ng/", LAGOS_BAKERY));
    expect(links).toEqual(["https://mamasbakery.ng/about-us", "https://mamasbakery.ng/contact", "https://mamasbakery.ng/menu"]);
  });

  it("decodes non-UTF-8 pages by their declared charset", () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
    expect(decodeBody(latin1, "text/html; charset=ISO-8859-1")).toBe("café");
    expect(decodeBody(Buffer.from("café"), undefined)).toBe("café");
  });

  it("keeps line breaks between blocks", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });
});

describe("location detection", () => {
  it("places a local business from schema.org, locale, phone, currency and domain", () => {
    const loc = detectLocation([page("https://mamasbakery.ng/", LAGOS_BAKERY)], "https://mamasbakery.ng");
    expect(loc).toMatchObject({ countryCode: "NG", country: "Nigeria", city: "Lagos", scope: "local", confidence: "high", source: "detected" });
    expect(loc.evidence.some((e) => e.includes("schema.org"))).toBe(true);
  });

  it("uses country domains but ignores vanity ones", () => {
    expect(tldCountry("shop.co.uk")).toBe("GB");
    expect(tldCountry("acme.io")).toBeNull();
    expect(tldCountry("acme.ai")).toBeNull();
    expect(tldCountry("acme.com")).toBeNull();
  });

  it("does not treat a default en-US template as strong evidence", () => {
    const loc = detectLocation([page("https://acme.io/", `<html lang="en-US"><body><h1>Developer API</h1></body></html>`)], "https://acme.io");
    expect(loc.confidence).toBe("low");
  });

  it("reports nothing rather than guessing", () => {
    const loc = detectLocation([page("https://acme.com/", "<html><body><h1>Hello</h1></body></html>")], "https://acme.com");
    expect(loc.countryCode).toBeNull();
    expect(loc.confidence).toBe("none");
  });

  it("ignores ambiguous country names like Turkey on a menu", () => {
    const loc = detectLocation([page("https://diner.com/", "<html><body>Roast turkey sandwich with chile sauce</body></html>")], "https://diner.com");
    expect(loc.countryCode).toBeNull();
  });

  it("normalises country names and codes", () => {
    expect(toCountryCode("Nigeria")).toBe("NG");
    expect(toCountryCode("UK")).toBe("GB");
    expect(toCountryCode({ name: "Kenya" })).toBe("KE");
    expect(toCountryCode("Atlantis")).toBeNull();
  });
});

describe("grounding extracted facts", () => {
  const base = { summary: "s", category: "c", targetUsers: [], valueProps: [], useCases: [], terminology: [], keywords: ["bread"] };
  it("drops integrations, competitors and prices the sources never state", () => {
    const r = groundProfile({ ...base, integrations: ["Paystack", "Shopify"], competitors: ["Sweet Sensation", "Krispy Kreme"], pricing: "₦1,500 per loaf" }, "Pay with Paystack. Unlike Sweet Sensation, loaves from ₦1,500.");
    expect(r.profile.integrations).toEqual(["Paystack"]);
    expect(r.profile.competitors).toEqual(["Sweet Sensation"]);
    expect(r.profile.pricing).toBe("₦1,500 per loaf");
    expect(r.dropped).toEqual(['integration "Shopify"', 'competitor "Krispy Kreme"']);
  });

  it("removes a price whose figures are not on the page", () => {
    const r = groundProfile({ ...base, integrations: [], competitors: [], pricing: "$29/month" }, "Contact us for pricing");
    expect(r.profile.pricing).toBeNull();
  });
});

describe("competitors", () => {
  it("finds competitors the site names itself", () => {
    const p = page("https://mamasbakery.ng/", LAGOS_BAKERY + "<p>The friendly alternative to Chicken Republic.</p>");
    const names = siteNamedCompetitors([p], "Mama's Bakery", "mamasbakery.ng").map((c) => c.name);
    expect(names).toContain("Sweet Sensation");
    expect(names).toContain("Chicken Republic");
  });

  const loc = detectLocation([page("https://mamasbakery.ng/", LAGOS_BAKERY)], "https://mamasbakery.ng");
  const sources = [
    { url: "https://www.bakersdelight.ng/", title: "Bakers Delight Lagos" },
    { url: "https://www.timeout.com/lagos/best-bakeries", title: "Best bakeries in Lagos" },
    { url: "https://londonloaf.co.uk/", title: "London Loaf" },
  ];
  const reader = (html: Record<string, PageText>) => async (u: string) => html[new URL(u).hostname] ?? { url: u, ok: false, headings: [], text: "", note: "getaddrinfo ENOTFOUND" };
  const pages = {
    "bakersdelight.ng": page("https://bakersdelight.ng/", `<html lang="en-NG"><body>Bakery in Ikeja, Lagos. Call +234 801 111 1111</body></html>`),
    "londonloaf.co.uk": page("https://londonloaf.co.uk/", `<html lang="en-GB"><body>Artisan bakery in London. Call +44 20 7946 0000. £3 a loaf.</body></html>`),
  };
  const cand = (name: string, website: string, evidenceUrls: string[] = []) => ({ name, website, reason: "r", serves: "Lagos", evidenceUrls });

  it("accepts a competitor that is in the search results and in the same market", async () => {
    const r = await verifyCandidate(cand("Bakers Delight", "https://www.bakersdelight.ng"), sources, loc, "mamasbakery.ng", reader(pages));
    expect(r.ok && r.record.locationCheck).toBe("verified");
  });

  it("rejects a competitor the search never returned", async () => {
    const r = await verifyCandidate(cand("Invented Bakes", "https://inventedbakes.ng"), sources, loc, "mamasbakery.ng", reader(pages));
    expect(r).toEqual({ ok: false, reason: "not found in the actual search results" });
  });

  it("rejects a competitor in another country", async () => {
    const r = await verifyCandidate(cand("London Loaf", "https://londonloaf.co.uk"), sources, loc, "mamasbakery.ng", reader(pages));
    expect(r).toEqual({ ok: false, reason: "operates in United Kingdom, not Nigeria" });
  });

  it("rejects the business's own site and dead domains", async () => {
    expect((await verifyCandidate(cand("Me", "https://mamasbakery.ng"), sources, loc, "mamasbakery.ng", reader(pages))).ok).toBe(false);
    const dead = await verifyCandidate(cand("Gone", "https://gone.ng", ["https://www.timeout.com/lagos/best-bakeries"]), sources, loc, "mamasbakery.ng", reader(pages));
    expect(dead).toMatchObject({ ok: false });
  });

  it("keeps competitors whose site blocks bots, labelled as such", async () => {
    const blocked = async (u: string): Promise<PageText> => ({ url: u, ok: false, headings: [], text: "", note: "HTTP 403" });
    const r = await verifyCandidate(cand("Bakers Delight", "https://bakersdelight.ng"), sources, loc, "mamasbakery.ng", blocked);
    expect(r.ok && r.record.siteStatus).toBe("blocks_readers");
    expect(r.ok && r.record.locationCheck).toBe("search");
  });

  it("labels founder-added competitors and drops removed ones", () => {
    const kept = syncCompetitorDetails(["Bakers Delight", "New One"], [{ name: "bakers delight", website: "https://bakersdelight.ng", reason: null, source: "web_search", locationCheck: "verified", locationNote: null, evidenceUrls: [], siteStatus: "ok" }, { name: "Removed", website: null, reason: null, source: "site", locationCheck: "not_applicable", locationNote: null, evidenceUrls: [], siteStatus: "unchecked" }]);
    expect(kept.map((k) => [k.name, k.source])).toEqual([["bakers delight", "web_search"], ["New One", "founder"]]);
  });
});
