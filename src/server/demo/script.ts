import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DAY_MS } from "@/lib/time";
import { fmtUsdc } from "@/lib/money";
import { analyzeProject } from "@/server/domain/intel/analyze";
import { purchaseCompanyIntel } from "@/server/domain/agent/purchase";
import { createExperimentFromOpportunity, launchExperiment } from "@/server/domain/growth/experiments";
import { generateKolBrief } from "@/server/domain/growth/kol-brief";
import { recordConversion } from "@/server/domain/growth/attribution";
import { runLearning } from "@/server/domain/growth/learning-run";
import { buildDailyBrief } from "@/server/domain/growth/brief";
import { resolveApproval } from "@/server/domain/agent/execute";

/**
 * The guided hackathon demo. Each step calls the same engine functions the autonomous
 * operator uses; the only scripted part is *which* opportunity we spotlight and the DEMO
 * conversion events in step 6 (labelled DEMO, delivered through the real attribution path).
 */

export interface DemoStepResult {
  step: number;
  title: string;
  log: { agent: string; message: string }[];
  links: { label: string; href: string }[];
  done: boolean;
}

export const DEMO_STEPS = [
  { step: 1, title: "Detect the opportunity", detail: "Analyze the market corpus; Acme Labs shows intent but confidence is below the 80% commit threshold." },
  { step: 2, title: "Decide whether information is worth buying — and buy it over x402", detail: "Find an x402 service, quote it, compute expected value of information, run the policy engine, pay via Circle Gateway." },
  { step: 3, title: "Create an experiment and pick the creator", detail: "The strategist turns the strongest creator opportunity into a measurable experiment with a stop condition." },
  { step: 4, title: "Generate the evidence-backed KOL brief", detail: "Every claim cites a source; drafts are suggestions for the creator, never impersonation." },
  { step: 5, title: "Propose the creator payment", detail: "KOL spend is above the autonomous limit → the policy engine routes it to the Approval Inbox." },
  { step: 6, title: "Founder approves → App Kit Send", detail: "Approval waives approval-level rules only; deny rules are re-checked; App Kit sends USDC on Arc (or SIMULATED without a wallet)." },
  { step: 7, title: "Conversion events arrive", detail: "DEMO events flow through the real attribution path via the campaign's referral code." },
  { step: 8, title: "Learn and reallocate", detail: "Compare measured CPA across experiments; stop losers, move unspent budget to winners, through policy." },
] as const;

async function demoProject(db: DB, projectId: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  if (p?.dataMode !== "DEMO") throw new Error("The guided demo only runs on the DEMO project");
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, projectId), eq(s.missions.status, "active")));
  return { project: p, mission };
}

async function spotlightKolExperiment(db: DB, projectId: string) {
  const rows = await db.select().from(s.experiments).where(and(eq(s.experiments.projectId, projectId), eq(s.experiments.channel, "kol"))).orderBy(desc(s.experiments.number));
  return rows.find((r) => r.number > 3);
}

export async function runDemoStep(db: DB, projectId: string, step: number, userId: string): Promise<DemoStepResult> {
  const log: DemoStepResult["log"] = [];
  const L = (agent: string, message: string) => log.push({ agent, message });
  const { mission } = await demoProject(db, projectId);
  const title = DEMO_STEPS.find((x) => x.step === step)?.title ?? `Step ${step}`;
  const links: DemoStepResult["links"] = [];
  const [acme] = await db.select().from(s.companies).where(and(eq(s.companies.projectId, projectId), eq(s.companies.name, "Acme Labs")));

  switch (step) {
    case 1: {
      const stats = await analyzeProject(db, projectId, L);
      const [c] = await db.select().from(s.companies).where(eq(s.companies.id, acme.id));
      L("operator", `Acme Labs: overall ${c.overallScore}/100, confidence ${(c.confidence * 100).toFixed(0)}% — below the 80% commit threshold. Need more information.`);
      links.push({ label: "Acme Labs evidence", href: `/app/customers/${acme.id}` }, { label: "Narratives", href: "/app/narratives" });
      void stats;
      break;
    }
    case 2: {
      const r = await purchaseCompanyIntel(db, { projectId, companyId: acme.id, log: L });
      L("operator", `Outcome: ${r.state}${r.settlementId ? ` — settlement ${r.settlementId}` : ""}`);
      links.push({ label: "Decision receipt", href: `/app/receipts/${r.decisionId}` }, { label: "Arc / Circle activity", href: "/app/activity" });
      break;
    }
    case 3: {
      const opps = await db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, projectId), eq(s.opportunities.type, "KOL"), eq(s.opportunities.status, "open"))).orderBy(desc(s.opportunities.overallScore));
      const pick = opps.find((o) => o.confidence >= 0.8) ?? opps[0];
      if (!pick) throw new Error("No open KOL opportunity");
      const exp = await createExperimentFromOpportunity(db, { projectId, opportunityId: pick.id, log: L, budgetMicro: 150_000_000 });
      L("strategist", `Chose opportunity #${pick.number} (${pick.title}) — confidence ${(pick.confidence * 100).toFixed(0)}%, ranked by relevance not followers`);
      links.push({ label: `Experiment #${exp.number}`, href: `/app/experiments/${exp.id}` }, { label: "KOL ranking", href: "/app/kols" });
      break;
    }
    case 4: {
      const exp = await spotlightKolExperiment(db, projectId);
      if (!exp) throw new Error("Run step 3 first");
      const [camp] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id));
      const brief = await generateKolBrief(db, camp.kolId!, exp.id);
      L("kol", `Brief for ${brief.creator}: ${brief.claimsWithEvidence.length} sourced claims, drafts by ${brief.draftsGeneratedBy}`);
      links.push({ label: "Open brief", href: `/app/kols/${camp.kolId}/brief?experiment=${exp.id}` });
      break;
    }
    case 5: {
      const exp = await spotlightKolExperiment(db, projectId);
      if (!exp) throw new Error("Run step 3 first");
      const r = await launchExperiment(db, { projectId, experimentId: exp.id, log: L });
      L("policy", `${r.verdict}: ${r.message}`);
      links.push({ label: "Approval Inbox", href: "/app/approvals" });
      break;
    }
    case 6: {
      // Only the guided demo's own creator payment — never some other pending approval in the inbox.
      const exp = await spotlightKolExperiment(db, projectId);
      if (!exp) throw new Error("Run step 3 first");
      const [ap] = await db
        .select({ a: s.approvals })
        .from(s.approvals)
        .innerJoin(s.transactions, eq(s.approvals.transactionId, s.transactions.id))
        .where(and(eq(s.approvals.projectId, projectId), eq(s.approvals.status, "pending"), eq(s.transactions.experimentId, exp.id)))
        .orderBy(desc(s.approvals.createdAt))
        .then((rows) => rows.map((r) => r.a));
      if (!ap) throw new Error("Nothing pending for this experiment — run step 5 first (or approve it in the inbox)");
      const r = await resolveApproval(db, { approvalId: ap.id, userId, resolution: "approve", log: L, note: "Approved in guided demo" });
      L("operator", r.status === "approved" ? `Founder approved → ${r.state ?? "approved"}` : `Not executed (${r.status})${r.reason ? `: ${r.reason}` : ""}`);
      links.push({ label: "Activity", href: "/app/activity" }, { label: "Receipt", href: `/app/receipts/${ap.decisionId}` });
      break;
    }
    case 7: {
      const exp = await spotlightKolExperiment(db, projectId);
      if (!exp) throw new Error("Run step 3 first");
      const [camp] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id));
      const now = Date.now();
      let keys = 0;
      for (let i = 0; i < 38; i++) {
        const v = `demo-v-${exp.number}-${i}`;
        const t = new Date(now - DAY_MS + (i / 38) * DAY_MS);
        await recordConversion(db, { projectId, eventType: "visit", referralCode: camp.referralCode, visitorId: v, idempotencyKey: `demo-${projectId}-${exp.number}-visit-${i}`, occurredAt: t, source: "demo", dataMode: "DEMO" });
        if (i % 4 === 0) {
          keys++;
          await recordConversion(db, { projectId, eventType: "sdk_key_created", referralCode: camp.referralCode, visitorId: v, idempotencyKey: `demo-${projectId}-${exp.number}-key-${i}`, occurredAt: new Date(t.getTime() + 1_800_000), source: "demo", dataMode: "DEMO" });
        }
      }
      L("attribution", `38 visits and ${keys} SDK keys attributed to experiment #${exp.number} via referral code ${camp.referralCode} (DEMO events)`);
      links.push({ label: `Experiment #${exp.number}`, href: `/app/experiments/${exp.id}` });
      break;
    }
    case 8: {
      const r = await runLearning(db, { projectId, missionId: mission.id, log: L });
      if (r.moves.length) L("budget", `Moves: ${r.moves.map((m) => `${fmtUsdc(m.amountMicro)} — ${m.reason}`).join(" | ")}`);
      await buildDailyBrief(db, projectId);
      links.push({ label: "Mission result", href: `/app/missions` }, { label: "All receipts", href: "/app/activity#decisions" }, { label: "Growth Graph", href: "/app/graph" });
      break;
    }
    default:
      throw new Error("Unknown demo step");
  }
  return { step, title, log, links, done: true };
}
