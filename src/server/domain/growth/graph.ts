import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { fmtUsdc } from "@/lib/money";

export type NodeType = "product" | "narrative" | "customer" | "kol" | "competitor" | "community" | "opportunity" | "experiment" | "spend" | "result" | "learning";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  sub?: string;
  href?: string;
  mode?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
}

/** The Growth Graph: PRODUCT → market entities → opportunities → experiments → spend → results → learning. */
export async function buildGraph(db: DB, projectId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, projectId));
  const nodes: GraphNode[] = [{ id: "product", type: "product", label: project.name, sub: profile?.category, href: "/app/settings" }];
  const edges: GraphEdge[] = [];
  const add = (n: GraphNode, from?: string) => {
    if (!nodes.find((x) => x.id === n.id)) nodes.push(n);
    if (from) edges.push({ from, to: n.id });
  };

  const narratives = (await db.select().from(s.narratives).where(eq(s.narratives.projectId, projectId))).sort((a, b) => b.relevance - a.relevance).slice(0, 6);
  for (const n of narratives) add({ id: `n:${n.id}`, type: "narrative", label: n.label, sub: `${n.status} ${n.velocityPct >= 0 ? "+" : ""}${n.velocityPct}%`, href: `/app/narratives/${n.id}`, mode: n.dataMode }, "product");
  const nIds = narratives.map((n) => n.id);

  const companies = (await db.select().from(s.companies).where(eq(s.companies.projectId, projectId))).sort((a, b) => b.overallScore - a.overallScore).slice(0, 8);
  const nc = nIds.length ? await db.select().from(s.narrativeCompanies).where(inArray(s.narrativeCompanies.narrativeId, nIds)) : [];
  for (const c of companies) {
    const link = nc.find((x) => x.companyId === c.id);
    add({ id: `c:${c.id}`, type: "customer", label: c.name, sub: `intent ${c.intentScore} · fit ${c.fitScore}`, href: `/app/customers/${c.id}`, mode: c.dataMode }, link ? `n:${link.narrativeId}` : "product");
  }
  const kols = (await db.select().from(s.kols).where(eq(s.kols.projectId, projectId))).sort((a, b) => b.overallScore - a.overallScore).slice(0, 6);
  const nk = nIds.length ? await db.select().from(s.narrativeKols).where(inArray(s.narrativeKols.narrativeId, nIds)) : [];
  for (const k of kols) {
    const link = nk.find((x) => x.kolId === k.id);
    add({ id: `k:${k.id}`, type: "kol", label: `@${k.handle}`, sub: `score ${k.overallScore}`, href: `/app/kols/${k.id}`, mode: k.dataMode }, link ? `n:${link.narrativeId}` : "product");
  }
  for (const comp of profile?.competitors.slice(0, 4) ?? []) add({ id: `comp:${comp}`, type: "competitor", label: comp, sub: "competitor" }, "product");
  const providers = await db.select({ p: s.socialPosts.provider, n: sql<number>`count(*)::int` }).from(s.socialPosts).where(eq(s.socialPosts.projectId, projectId)).groupBy(s.socialPosts.provider);
  for (const pr of providers) add({ id: `src:${pr.p}`, type: "community", label: pr.p, sub: `${pr.n} posts` }, "product");

  const opps = (await db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, projectId)))).sort((a, b) => b.overallScore - a.overallScore).slice(0, 10);
  for (const o of opps) {
    const parent = o.companyId ? `c:${o.companyId}` : o.kolId ? `k:${o.kolId}` : o.narrativeId ? `n:${o.narrativeId}` : "product";
    if (!nodes.find((n) => n.id === parent)) continue;
    add({ id: `o:${o.id}`, type: "opportunity", label: `#${o.number} ${o.type}`, sub: `${Math.round(o.confidence * 100)}% conf`, href: `/app/opportunities/${o.id}`, mode: o.dataMode }, parent);
  }
  const exps = await db.select().from(s.experiments).where(eq(s.experiments.projectId, projectId));
  for (const x of exps) {
    const parent = x.opportunityId && nodes.find((n) => n.id === `o:${x.opportunityId}`) ? `o:${x.opportunityId}` : "product";
    add({ id: `x:${x.id}`, type: "experiment", label: `EXP #${x.number}`, sub: x.status, href: `/app/experiments/${x.id}`, mode: x.dataMode }, parent);
    const [spend] = await db.select({ n: sql<string>`coalesce(sum(${s.transactions.amountMicro}),0)` }).from(s.transactions).where(and(eq(s.transactions.experimentId, x.id), inArray(s.transactions.state, ["SUBMITTED", "SETTLED", "EXECUTING", "EXCEPTION"])));
    if (Number(spend?.n ?? 0) > 0) add({ id: `sp:${x.id}`, type: "spend", label: fmtUsdc(Number(spend.n)), sub: "committed", href: "/app/activity" }, `x:${x.id}`);
    const [conv] = await db.select({ n: sql<number>`count(*)::int` }).from(s.attribution).where(eq(s.attribution.experimentId, x.id));
    if ((conv?.n ?? 0) > 0) add({ id: `r:${x.id}`, type: "result", label: `${conv.n} conversions`, sub: (x.outcome as { verdict?: string } | null)?.verdict ?? "measuring", href: `/app/experiments/${x.id}` }, Number(spend?.n ?? 0) > 0 ? `sp:${x.id}` : `x:${x.id}`);
  }
  const learnings = await db.select().from(s.learnings).where(eq(s.learnings.projectId, projectId));
  for (const l of learnings.slice(-3)) {
    const moves = l.reallocations as { toExperimentId?: string; fromExperimentId?: string }[];
    add({ id: `l:${l.id}`, type: "learning", label: moves.length ? `Reallocated ×${moves.length}` : "Learning", sub: l.createdAt.toISOString().slice(0, 10), href: "/app/missions" });
    for (const m of moves) {
      if (m.fromExperimentId && nodes.find((n) => n.id === `r:${m.fromExperimentId}`)) edges.push({ from: `r:${m.fromExperimentId}`, to: `l:${l.id}` });
      if (m.toExperimentId) edges.push({ from: `l:${l.id}`, to: `x:${m.toExperimentId}` });
    }
  }
  return { nodes, edges: edges.filter((e) => nodes.find((n) => n.id === e.from) && nodes.find((n) => n.id === e.to)) };
}
