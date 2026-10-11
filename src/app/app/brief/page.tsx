import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ArrowRight, CircleDollarSign, Compass, FlaskConical, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { buildDailyBrief } from "@/server/domain/growth/brief";
import { activeMission, missionBudget } from "@/server/queries/missions";
import { rebuildDailyBriefAction } from "@/server/actions/agent";
import { fmtUsdc } from "@/lib/money";
import { Badge, Card, CardBody, CardFooter, CardHeader, Confidence, ModeBadge, PageHeader, Progress, Stat, StatStrip, Velocity } from "@/components/ui";
import { ActionButton } from "@/components/features/agent/action-button";

type Brief = Awaited<ReturnType<typeof buildDailyBrief>>;

export default async function DailyBrief() {
  const { project, role, db } = await requireProject();
  const [row] = await db.select().from(s.dailyBriefs).where(eq(s.dailyBriefs.projectId, project.id)).orderBy(desc(s.dailyBriefs.date)).limit(1);
  // Viewing never writes: without a saved brief this is an unsaved preview until Rebuild or the next cycle.
  const b: Brief = row ? (row.content as unknown as Brief) : await buildDailyBrief(db, project.id, Date.now(), { persist: false });
  // Budget is read live (same helper as Overview) so "Available" matches everywhere, not a stale snapshot.
  const mission = await activeMission(db, project.id);
  const budget = mission ? await missionBudget(db, mission) : null;
  const date = new Date(b.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const w = b.whatChanged;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="Daily brief"
        description="Assembled from the database, not written by a model — every number is a count of real rows."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>{date}</span>
            {!row && <span className="text-ink-4">· live preview, not yet saved</span>}
          </>
        }
        actions={can(role, "operate") && <ActionButton action={rebuildDailyBriefAction} label="Rebuild" icon={<RefreshCw />} />}
      />

      <Card className="border-accent/30 bg-gradient-to-b from-accent/[0.06] to-transparent">
        <CardBody className="flex gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-s1" />
          <div>
            <div className="label mb-1">Today</div>
            <p className="text-[15px] leading-relaxed text-ink">{b.recommendation}</p>
          </div>
        </CardBody>
      </Card>

      <div>
        <div className="label mb-2">What changed · as of {row ? "the last build" : "now"}</div>
        <StatStrip className="grid-cols-2 sm:grid-cols-5">
          <Stat label="New conversations" value={w.newConversations} sub="collected in 24h" />
          <Stat label="New high-intent companies" value={w.highIntentCompanies} sub="found in 24h" />
          <Stat label="Emerging narratives" value={w.emergingNarratives} sub="emerging or accelerating now" />
          <Stat label="New creator opps" value={w.kolOpportunities} sub="open, found in 24h" />
          <Stat label="Product issues" value={w.productIssues} sub="mentioned this week" tone={w.productIssues ? "warn" : undefined} />
        </StatStrip>
      </div>

      {b.topOpportunity ? (
        <Card>
          <CardHeader title="Top opportunity" icon={<Target />} action={<Confidence value={b.topOpportunity.confidence} />} />
          <CardBody className="space-y-4">
            <Link href={`/app/opportunities/${b.topOpportunity.id}`} className="group flex items-start gap-2">
              <span className="num pt-0.5 text-[13px] text-ink-4">#{b.topOpportunity.number}</span>
              <span className="text-[15px] font-semibold leading-snug text-ink group-hover:underline">{b.topOpportunity.title}</span>
              <Badge tone="muted" className="ml-auto mt-0.5">
                {b.topOpportunity.type}
              </Badge>
            </Link>
            {b.topOpportunity.whyNow.length > 0 && (
              <div>
                <div className="label mb-1.5">Why it matters</div>
                <ul className="space-y-1.5 text-[12.5px] leading-snug text-ink-2">
                  {b.topOpportunity.whyNow.slice(0, 4).map((x) => (
                    <li key={x} className="flex gap-2">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4" />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-[8px] border border-line bg-bg/50 px-3 py-2.5">
              <div className="label mb-1">Recommended action</div>
              <p className="text-[12.5px] text-ink">{b.topOpportunity.recommendedAction}</p>
            </div>
          </CardBody>
          <CardFooter>
            <span>Highest-scoring open opportunity</span>
            <Link href={`/app/opportunities/${b.topOpportunity.id}`} className="inline-flex items-center gap-1 hover:text-ink">
              Open <ArrowRight className="size-3" />
            </Link>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Top opportunity" icon={<Target />} />
          <CardBody className="text-[12.5px] text-ink-3">No open opportunities — they appear after a scan or cycle scores the evidence collected from your sources.</CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Narratives moving" icon={<TrendingUp />} action={<Link href="/app/narratives" className="text-[12px] text-ink-3 hover:text-ink">All →</Link>} />
          {b.narratives.length ? (
            <ul className="divide-y divide-line">
              {b.narratives.map((n) => (
                <li key={n.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                  <span className="min-w-0 truncate">
                    <span className="text-ink">{n.label}</span> <Badge tone="info" className="ml-1">{n.status.toLowerCase()}</Badge>
                  </span>
                  <Velocity pct={n.velocityPct} />
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-ink-3">Nothing emerging or accelerating today.</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Budget" icon={<CircleDollarSign />} action={<Link href="/app/wallet" className="text-[12px] text-ink-3 hover:text-ink">Wallet →</Link>} />
          <CardBody>
            {budget ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Stat size="sm" label="Total" value={fmtUsdc(budget.budget, { unit: false })} />
                  <Stat size="sm" label="Spent" value={fmtUsdc(budget.spent, { unit: false })} />
                  <Stat size="sm" label="Available" value={fmtUsdc(budget.available, { unit: false })} tone="good" />
                </div>
                <Progress className="mt-4" value={budget.spent + budget.committed} max={budget.budget} />
                <div className="mt-1.5 text-[11px] text-ink-3">
                  <span className="num">{fmtUsdc(budget.awaitingApproval)}</span> awaiting approval · <span className="num">{fmtUsdc(budget.reserved)}</span> reserved by open experiments
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-ink-3">No active mission — set one to give the operator a budget.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Experiments" icon={<FlaskConical />} action={<Link href="/app/experiments" className="text-[12px] text-ink-3 hover:text-ink">All →</Link>} />
        <CardBody>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Succeeded / scaling" value={b.experiments.succeeded} sub="updated in 24h" tone={b.experiments.succeeded ? "good" : undefined} />
            <Stat label="Failed / stopped" value={b.experiments.failed} sub="updated in 24h" tone={b.experiments.failed ? "bad" : undefined} />
            <Stat label="Running" value={b.experiments.running} sub="now" />
          </div>
        </CardBody>
        <CardFooter>
          <span className="flex items-center gap-1.5">
            <Compass className="size-3.5" /> Counts come from experiment status changes, not model output.
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
