import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { ARC, DISCOVERY_API } from "@/server/integrations/circle/config";

/**
 * Circle Agent Marketplace — discovered through Circle's keyless Discovery API
 * (the same endpoint `circle services search` uses). Results are cached as vendors/services.
 */

interface DiscoveryItem {
  resource: string;
  type: string;
  metadata: {
    provider: { name: string; category?: string; description?: string; website?: string; tags?: string[] };
    path?: string;
    method: string;
    description: string;
    input?: Record<string, unknown>;
  };
  accepts?: { amount?: string; network?: string; payTo?: string; extra?: { name?: string } }[];
}

export interface DiscoveredService {
  resourceUrl: string;
  vendor: string;
  category: string | null;
  description: string;
  method: string;
  priceMicro: number | null;
  network: string | null;
  payableOnArc: boolean;
}

export async function searchMarketplace(query: string, opts: { category?: string; limit?: number } = {}): Promise<DiscoveredService[]> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 20), siwx: "false" });
  if (query) params.set("query", query);
  if (opts.category) params.set("category", opts.category);
  const res = await fetch(`${DISCOVERY_API}?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Circle Discovery API HTTP ${res.status}`);
  const data = (await res.json()) as { items?: DiscoveryItem[] };
  return (data.items ?? []).map((i) => {
    const arc = i.accepts?.find((a) => a.network === ARC.caip2);
    const any = arc ?? i.accepts?.[0];
    return {
      resourceUrl: i.resource,
      vendor: i.metadata.provider.name,
      category: i.metadata.provider.category ?? null,
      description: i.metadata.description,
      method: i.metadata.method?.toUpperCase() ?? "GET",
      priceMicro: any?.amount ? Number(any.amount) : null,
      network: any?.network ?? null,
      payableOnArc: !!arc && arc.extra?.name === "GatewayWalletBatched",
    };
  });
}

export async function upsertService(db: DB, svc: { vendor: string; vendorSource: "circle_marketplace" | "growthos"; vendorCategory?: string | null; website?: string | null; resourceUrl: string; method: string; description: string; category?: string | null; priceMicro?: number | null; network?: string | null; payTo?: string | null; capabilities: string[] }) {
  const [v] = await db
    .insert(s.vendors)
    .values({ id: newId(), name: svc.vendor, category: svc.vendorCategory ?? null, website: svc.website ?? null, source: svc.vendorSource })
    .onConflictDoUpdate({ target: s.vendors.name, set: { category: svc.vendorCategory ?? null } })
    .returning({ id: s.vendors.id });
  const [row] = await db
    .insert(s.services)
    .values({ id: newId(), vendorId: v.id, resourceUrl: svc.resourceUrl, method: svc.method, description: svc.description, category: svc.category ?? null, priceMicro: svc.priceMicro ?? null, network: svc.network ?? null, payTo: svc.payTo ?? null, capabilities: svc.capabilities })
    .onConflictDoUpdate({ target: s.services.resourceUrl, set: { priceMicro: svc.priceMicro ?? null, network: svc.network ?? null, description: svc.description, capabilities: svc.capabilities, lastSeenAt: new Date() } })
    .returning();
  return row;
}

/** Map marketplace categories/text to the capabilities GrowTendril needs. */
export function inferCapabilities(text: string): string[] {
  const t = text.toLowerCase();
  const caps: string[] = [];
  if (/compan|enrich|firmograph|business|funding|hiring/.test(t)) caps.push("company_enrichment");
  if (/social|twitter|x\.com|creator|influenc|audience/.test(t)) caps.push("creator_audience");
  if (/trend|news|sentiment|narrative|search/.test(t)) caps.push("narrative_pulse");
  if (/research|web search|crawl/.test(t)) caps.push("research");
  return caps;
}

/** Refresh the catalog from Circle's marketplace. Returns how many Arc-payable services were found. */
export async function refreshMarketplace(db: DB, queries = ["company data", "web search research", "social analytics", "news"]): Promise<{ found: number; arcPayable: number; error?: string }> {
  let found = 0;
  let arcPayable = 0;
  try {
    for (const q of queries) {
      for (const svc of await searchMarketplace(q, { limit: 15 })) {
        found++;
        if (svc.payableOnArc) arcPayable++;
        await upsertService(db, {
          vendor: svc.vendor,
          vendorSource: "circle_marketplace",
          vendorCategory: svc.category,
          resourceUrl: svc.resourceUrl,
          method: svc.method,
          description: svc.description,
          category: svc.category,
          priceMicro: svc.priceMicro,
          network: svc.network,
          capabilities: inferCapabilities(`${svc.category ?? ""} ${svc.description} ${svc.vendor}`),
        });
      }
    }
    return { found, arcPayable };
  } catch (e) {
    return { found, arcPayable, error: (e as Error).message };
  }
}

export const SIGNALS_API_URL = process.env.SIGNALS_API_URL ?? "http://localhost:4021";

/** Register the bundled x402 seller (services/signals-api) so the agent can discover it alongside marketplace services. */
export async function registerBundledSignalsService(db: DB) {
  const base = SIGNALS_API_URL.replace(/\/$/, "");
  const defs = [
    { path: "/v1/company-intel", price: 10_000, caps: ["company_enrichment"], desc: "Company intent enrichment: GitHub org activity, recent HN discussion, hiring/funding mentions" },
    { path: "/v1/creator-audience", price: 20_000, caps: ["creator_audience"], desc: "Creator audience composition and authenticity signals" },
    { path: "/v1/narrative-pulse", price: 5_000, caps: ["narrative_pulse"], desc: "Weekly discussion volume for a term (Hacker News, last 4 weeks)" },
  ];
  for (const d of defs) {
    await upsertService(db, {
      vendor: "GrowTendril Signals (bundled seller)",
      vendorSource: "growthos",
      vendorCategory: "DATA",
      website: base,
      resourceUrl: `${base}${d.path}`,
      method: "GET",
      description: d.desc,
      category: "DATA",
      priceMicro: d.price,
      network: ARC.caip2,
      capabilities: d.caps,
    });
  }
}

export async function servicesWithCapability(db: DB, cap: string) {
  const rows = await db.select({ svc: s.services, vendor: s.vendors }).from(s.services).innerJoin(s.vendors, eq(s.services.vendorId, s.vendors.id));
  return rows.filter((r) => r.svc.capabilities.includes(cap));
}
