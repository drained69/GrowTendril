import { describe, it, expect } from "vitest";
import { CONVERSION_EVENTS, EVENT_LABEL } from "../src/server/domain/growth/attribution-links";

process.env.PGLITE_DIR = "memory://";
delete process.env.ANTHROPIC_API_KEY; // exercise the deterministic fallback

describe("works for businesses beyond Web3", () => {
  it("offers outcomes for any kind of product, each with a label", () => {
    for (const e of ["signup", "lead", "trial_start", "app_install", "booking", "purchase"]) expect(CONVERSION_EVENTS).toContain(e);
    for (const e of CONVERSION_EVENTS) expect(EVENT_LABEL[e]).toBeTruthy();
  });

  it("classifies non-technical products and does not call everything developer tooling", async () => {
    const { analyzeProduct } = await import("../src/server/domain/intel/product-analyst");
    const cases: [string, string, RegExp, RegExp][] = [
      ["Artisan Candles", "Hand-poured soy candles and gift sets. Free shipping and returns, shop our collection.", /E-commerce/, /Shoppers|Gift/],
      ["BookIt Local", "A marketplace to book local cleaners and plumbers. Appointment booking in minutes.", /Marketplaces/, /Customers booking/],
      ["Ledgerly", "Invoicing and budgeting for small businesses. Send invoices and track savings.", /Finance/, /Small-business|Consumers/],
      ["FlowDesk", "A SaaS platform that automates team workflows with integrations. Subscription for teams.", /SaaS/, /Operations|Team leads/],
    ];
    const { proposeIcp } = await import("../src/server/domain/intel/product-analyst");
    for (const [name, description, category, users] of cases) {
      const r = await analyzeProduct({ name, description });
      if (/E-commerce/.test(r.profile.category)) {
        // A shop's customers are individuals, so the ideal customer is described as people, not "teams adopting".
        const icp = await proposeIcp(r.profile, name);
        expect(icp.icps[0].title).toMatch(/^People looking for/);
        expect(icp.icps.map((i) => i.title + i.description).join(" ")).not.toMatch(/Teams adopting|Companies whose/);
      }
      expect(r.profile.category).toMatch(category);
      expect(r.profile.targetUsers.join(" ")).toMatch(users);
      expect(r.profile.targetUsers.join(" ")).not.toMatch(/Developers|Technical founders/);
    }
  });

  it("stays neutral when nothing matches, instead of assuming developers", async () => {
    const { analyzeProduct, proposeIcp } = await import("../src/server/domain/intel/product-analyst");
    const r = await analyzeProduct({ name: "Zorp", description: "Zorp is a thing people enjoy using every day." });
    expect(r.profile.category).toBe("General product");
    expect(r.profile.targetUsers.join(" ")).not.toMatch(/Developers/);
    const icp = await proposeIcp(r.profile, "Zorp");
    expect(icp.icps.map((i) => i.title).join(" ")).not.toMatch(/Developers/);
  });
});
