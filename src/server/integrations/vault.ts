import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { decryptJson, encryptJson, secretHint } from "@/server/security/secrets";
import { audit } from "@/server/db/helpers";
import { PROVIDERS, providerById, type Credentials, type MarketProvider } from "@/server/integrations/providers";
import { daysAgo } from "@/lib/time";
import { publicUrl } from "@/server/security/public-http";

/**
 * Workspace integrations: per-project provider credentials, encrypted at rest.
 * Resolution order: workspace vault → platform env defaults → keyless.
 */

export type CredentialSource = "workspace" | "platform" | "keyless" | "missing" | "restricted";

export interface ProviderConnection {
  provider: MarketProvider;
  source: CredentialSource;
  ready: boolean;
  hint: string | null;
  status: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  config: Record<string, string>;
}

const aad = (projectId: string, provider: string) => `integration:${projectId}:${provider}`;

function platformCredentials(p: MarketProvider): Credentials {
  const c: Credentials = {};
  for (const [field, env] of Object.entries(p.envFallback)) if (process.env[env]) c[field] = process.env[env]!;
  return c;
}

function credentialsForProvider(p: MarketProvider, projectId: string, row?: typeof s.integrations.$inferSelect): { creds: Credentials; source: CredentialSource } {
  if (p.access === "restricted") return { creds: {}, source: "restricted" };
  if (row) return { creds: { ...decryptJson(row.secret, aad(projectId, p.id)), ...row.config }, source: "workspace" };
  const platform = platformCredentials(p);
  // Only a key or a required setting makes it a platform credential; optional extras (a user agent) don't.
  const keyed = p.credentialFields.some((f) => platform[f.key] && (f.secret || !f.optional));
  if (keyed && p.isReady(platform)) return { creds: platform, source: "platform" };
  if (!p.credentialFields.some((f) => !f.optional)) return { creds: p.isReady(platform) ? platform : {}, source: "keyless" };
  return { creds: {}, source: "missing" };
}

export async function resolveCredentials(db: DB, projectId: string, p: MarketProvider): Promise<{ creds: Credentials; source: CredentialSource }> {
  if (p.access === "restricted") return { creds: {}, source: "restricted" };
  const [row] = await db.select().from(s.integrations).where(and(eq(s.integrations.projectId, projectId), eq(s.integrations.provider, p.id)));
  return credentialsForProvider(p, projectId, row);
}

export async function listConnections(db: DB, projectId: string): Promise<ProviderConnection[]> {
  const rows = await db.select().from(s.integrations).where(eq(s.integrations.projectId, projectId));
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return PROVIDERS.map((p) => {
    const row = byProvider.get(p.id);
    const { creds, source } = credentialsForProvider(p, projectId, row);
    return {
      provider: p,
      source,
      ready: p.access !== "restricted" && p.isReady(creds),
      hint: row?.hint ?? null,
      status: row?.status ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      lastError: row?.lastError ?? null,
      config: row?.config ?? {},
    };
  });
}

/** Providers that can run for this workspace right now, with their credentials. */
export async function readyProviders(db: DB, projectId: string): Promise<{ provider: MarketProvider; creds: Credentials; source: CredentialSource }[]> {
  const rows = await db.select().from(s.integrations).where(eq(s.integrations.projectId, projectId));
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const out: { provider: MarketProvider; creds: Credentials; source: CredentialSource }[] = [];
  for (const p of PROVIDERS) {
    const r = credentialsForProvider(p, projectId, byProvider.get(p.id));
    if (r.source !== "restricted" && r.source !== "missing" && p.isReady(r.creds)) out.push({ provider: p, ...r });
  }
  return out;
}

export async function saveIntegration(db: DB, a: { projectId: string; providerId: string; fields: Record<string, string>; userId: string }) {
  const p = providerById(a.providerId);
  if (!p || p.access === "restricted") throw new Error("Unknown or restricted provider");
  const secret: Credentials = {};
  const config: Credentials = {};
  for (const f of p.credentialFields) {
    const v = (a.fields[f.key] ?? "").trim();
    if (!v) {
      if (!f.optional) throw new Error(`${f.label} is required`);
      continue;
    }
    if (v.length > 2000) throw new Error(`${f.label} is too long`);
    if (p.id === "rss" && f.key === "feeds") {
      const feeds = v.split(",").map((feed) => feed.trim()).filter(Boolean);
      if (!feeds.length || feeds.length > 10) throw new Error("Choose between 1 and 10 public RSS feeds");
      for (const feed of feeds) publicUrl(feed);
    }
    (f.secret ? secret : config)[f.key] = v;
  }
  if (!p.isReady({ ...secret, ...config })) throw new Error("These credentials are incomplete for this provider");
  const firstSecret = p.credentialFields.find((f) => f.secret && secret[f.key]);
  const values = {
    secret: encryptJson(secret, aad(a.projectId, p.id)),
    hint: firstSecret ? secretHint(secret[firstSecret.key]) : null,
    config,
    status: "connected",
    lastError: null,
    updatedAt: new Date(),
  };
  await db
    .insert(s.integrations)
    .values({ id: newId(), projectId: a.projectId, provider: p.id, createdBy: a.userId, ...values })
    .onConflictDoUpdate({ target: [s.integrations.projectId, s.integrations.provider], set: values });
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "integration.connect", target: p.id });
}

export async function removeIntegration(db: DB, a: { projectId: string; providerId: string; userId: string }) {
  await db.delete(s.integrations).where(and(eq(s.integrations.projectId, a.projectId), eq(s.integrations.provider, a.providerId)));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "integration.disconnect", target: a.providerId });
}

/** Live check: one tiny search with the workspace's credentials. Records the outcome. */
export async function testIntegration(db: DB, a: { projectId: string; providerId: string }): Promise<{ ok: boolean; message: string }> {
  const p = providerById(a.providerId);
  if (!p) throw new Error("Unknown provider");
  const { creds, source } = await resolveCredentials(db, a.projectId, p);
  if (!p.isReady(creds)) return { ok: false, message: "Not configured" };
  const [profile] = await db.select({ k: s.productProfiles.keywords }).from(s.productProfiles).where(eq(s.productProfiles.projectId, a.projectId));
  let result: { ok: boolean; message: string };
  try {
    const posts = await p.search(profile?.k[0] ?? "api", { since: daysAgo(7), limit: 5 }, creds);
    result = { ok: true, message: `Connected — ${posts.length} result(s) for “${profile?.k[0] ?? "api"}” in the last 7 days` };
  } catch (e) {
    result = { ok: false, message: (e as Error).message.slice(0, 300) };
  }
  if (source === "workspace")
    await db
      .update(s.integrations)
      .set({ status: result.ok ? "connected" : "error", lastCheckedAt: new Date(), lastError: result.ok ? null : result.message })
      .where(and(eq(s.integrations.projectId, a.projectId), eq(s.integrations.provider, p.id)));
  return result;
}
