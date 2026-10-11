import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { decryptJson, encryptJson, secretHint } from "@/server/security/secrets";
import { audit } from "@/server/db/helpers";
import { PROVIDERS, providerById, type Credentials, type MarketProvider } from "@/server/integrations/providers";
import { daysAgo } from "@/lib/time";

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

export async function resolveCredentials(db: DB, projectId: string, p: MarketProvider): Promise<{ creds: Credentials; source: CredentialSource }> {
  if (p.access === "restricted") return { creds: {}, source: "restricted" };
  const [row] = await db.select().from(s.integrations).where(and(eq(s.integrations.projectId, projectId), eq(s.integrations.provider, p.id)));
  if (row) return { creds: { ...decryptJson(row.secret, aad(projectId, p.id)), ...row.config }, source: "workspace" };
  const platform = platformCredentials(p);
  if (Object.keys(platform).length && p.isReady(platform)) return { creds: platform, source: "platform" };
  if (!p.credentialFields.filter((f) => !f.optional).length) return { creds: {}, source: "keyless" };
  return { creds: {}, source: "missing" };
}

export async function listConnections(db: DB, projectId: string): Promise<ProviderConnection[]> {
  const rows = await db.select().from(s.integrations).where(eq(s.integrations.projectId, projectId));
  return Promise.all(
    PROVIDERS.map(async (p) => {
      const row = rows.find((r) => r.provider === p.id);
      const { creds, source } = await resolveCredentials(db, projectId, p);
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
    }),
  );
}

/** Providers that can run for this workspace right now, with their credentials. */
export async function readyProviders(db: DB, projectId: string): Promise<{ provider: MarketProvider; creds: Credentials; source: CredentialSource }[]> {
  const out: { provider: MarketProvider; creds: Credentials; source: CredentialSource }[] = [];
  for (const p of PROVIDERS) {
    const r = await resolveCredentials(db, projectId, p);
    if (r.source !== "restricted" && r.source !== "missing" && p.isReady(r.creds)) out.push({ provider: p, ...r });
  }
  return out;
}

/**
 * Builds the values to store from a form submission. Secrets are never sent back to the browser,
 * so a blank secret field means "keep the stored one" — never "wipe it".
 */
export function mergeCredentialFields(p: MarketProvider, fields: Record<string, string>, stored: Credentials | null): { secret: Credentials; config: Credentials } {
  const secret: Credentials = {};
  const config: Credentials = {};
  let entered = 0;
  for (const f of p.credentialFields) {
    const v = (fields[f.key] ?? "").trim();
    if (v.length > 2000) throw new Error(`${f.label} is too long`);
    if (v) {
      entered++;
      (f.secret ? secret : config)[f.key] = v;
    } else if (f.secret && stored?.[f.key]) secret[f.key] = stored[f.key];
    else if (!f.optional) throw new Error(`${f.label} is required`);
  }
  if (!entered) throw new Error("Nothing to save — enter at least one value");
  return { secret, config };
}

export async function saveIntegration(db: DB, a: { projectId: string; providerId: string; fields: Record<string, string>; userId: string }) {
  const p = providerById(a.providerId);
  if (!p || p.access === "restricted") throw new Error("Unknown or restricted provider");
  const [row] = await db.select().from(s.integrations).where(and(eq(s.integrations.projectId, a.projectId), eq(s.integrations.provider, p.id)));
  const stored = row ? decryptJson(row.secret, aad(a.projectId, p.id)) : null;
  const { secret, config } = mergeCredentialFields(p, a.fields, stored);
  if (!p.isReady({ ...secret, ...config })) throw new Error("These credentials are incomplete for this provider");
  await p.validate?.({ ...secret, ...config });
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

/**
 * Live check: one tiny search with the resolved credentials. The outcome is stored only for
 * workspace credentials (platform/keyless sources have no row) — the caller shows it directly.
 */
export async function testIntegration(db: DB, a: { projectId: string; providerId: string }): Promise<{ ok: boolean; message: string }> {
  const p = providerById(a.providerId);
  if (!p) throw new Error("Unknown provider");
  const { creds, source } = await resolveCredentials(db, a.projectId, p);
  if (!p.isReady(creds)) return { ok: false, message: "Not configured" };
  const [profile] = await db.select({ k: s.productProfiles.keywords }).from(s.productProfiles).where(eq(s.productProfiles.projectId, a.projectId));
  let result: { ok: boolean; message: string };
  const warnings: string[] = [];
  try {
    const posts = await p.search(profile?.k[0] ?? "api", { since: daysAgo(7), limit: 5, warnings }, creds);
    result = warnings.length
      ? { ok: false, message: `Partly working — ${posts.length} result(s), but ${warnings.join("; ")}`.slice(0, 300) }
      : { ok: true, message: `Connected — ${posts.length} result(s) for “${profile?.k[0] ?? "api"}” in the last 7 days` };
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
