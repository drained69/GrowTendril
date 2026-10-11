import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ArrowRight, Brain, Flag, Plus } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { missionSummary, CATEGORY_LABEL } from "@/server/queries/missions";
import { runLearningAction } from "@/server/actions/growth";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { fmtUsdc } from "@/lib/money";
import { isoDate, relTime } from "@/lib/time";
import { Badge, Card, CardBody, CardFooter, CardHeader, EmptyState, LinkButton, ModeBadge, PageHeader, Stat, StatusBadge, Table } from "@/components/ui";
import { GoalProgress, StackedBar } from "@/components/charts";
import { ActionButton } from "@/components/features/agent/action-button";

type Finding = { label: string; verdict: string; reason: string };
type Realloc = { amountMicro: number; reason: string };
const VERDICT_TONE = (v: string) => (v === "SCALE" ? "good" : v === "STOP" || v === "REDUCE" ? "bad" : "neutral") as "good" | "bad" | "neutral";

export default async function Missions() {
  const { project, role, db } = await requireProject();
  const operate = can(role, "operate");
  const [missions, learnings] = await Promise.all([
    db.select().from(s.missions).where(eq(s.missions.projectId, project.id)).orderBy(desc(s.missions.createdAt)),
    db.select().from(s.learnings).where(eq(s.learnings.projectId, project.id)).orderBy(desc(s.learnings.createdAt)).limit(5),
  ]);
  const summaries = await Promise.all(missions.map((m) => missionSummary(db, m)));
  const hasActive = missions.some((m) => m.status === "active");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Missions"
        description="A mission is a goal, a timeframe and a budget. Results are counted from conversion events, never estimated."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>
              {missions.length} mission{missions.length === 1 ? "" : "s"}
            </span>
          </>
        }
        actions={
          <>
            {operate && hasActive && <ActionButton action={runLearningAction} label="Run learning" icon={<Brain />} logTitle="Learning run" />}
            {operate && (
              <LinkButton href="/onboarding?step=3" icon={<Plus />} variant="primary">
                New mission
              </LinkButton>
            )}
          </>
        }
      />

      {!missions.length && (
        <EmptyState
          icon={<Flag />}
          title="No missions yet"
          description="A mission gives the operator a measurable goal and a USDC budget ceiling. Nothing is spent without one."
          action={operate ? <LinkButton href="/onboarding?step=3" variant="primary" icon={<Plus />}>Create mission</LinkButton> : undefined}
        />
      )}

      {missions.map((m, i) => {
        const sum = summaries[i];
        const pct = Math.round((sum.achieved / Math.max(1, m.goalTarget)) * 100);
        return (
          <Card key={m.id}>
            <CardHeader
              icon={<Flag />}
              title={m.name}
              description={m.goalDescription}
              action={
                <>
                  <ModeBadge mode={m.dataMode} />
                  <StatusBadge status={m.status} />
                  <span className="num hidden text-[11.5px] text-ink-3 sm:inline">
                    {isoDate(m.startsAt)} → {isoDate(m.endsAt)}
                  </span>
                </>
              }
            />
            <div className="grid lg:grid-cols-[1.25fr_1fr]">
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-[11.5px] font-medium text-ink-3">{EVENT_LABEL[m.goalEvent as ConversionEventType] ?? m.goalEvent}</div>
                    <div className="num mt-1 text-[30px] font-medium leading-none tracking-[-0.03em]">
                      {sum.achieved}
                      <span className="text-[15px] text-ink-3"> / {m.goalTarget}</span>
                    </div>
                  </div>
                  <div className="text-right text-[11.5px] text-ink-3">
                    <div className="num text-[13px] text-ink">{pct}%</div>
                    {m.status === "active" ? `${sum.daysLeft}d left · on-pace ${Math.round(sum.pace)}` : "final"}
                  </div>
                </div>
                <GoalProgress achieved={sum.achieved} goal={m.goalTarget} pace={m.status === "active" ? sum.pace : undefined} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                  <Stat size="sm" label="Attributed" value={sum.attributed} sub="to experiments" />
                  <Stat size="sm" label="Budget" value={fmtUsdc(m.budgetMicro, { unit: false })} sub="USDC" />
                  <Stat size="sm" label="Spent" value={fmtUsdc(sum.spent, { unit: false })} sub="settled + in flight" />
                  <Stat size="sm" label="Cost / qualified" value={sum.costPerQualified ? fmtUsdc(sum.costPerQualified, { unit: false }) : "—"} sub="USDC, measured" />
                  <Stat size="sm" label="Experiments" value={sum.experiments} sub={`${sum.successful} successful`} />
                  <Stat size="sm" label="Committed" value={fmtUsdc(sum.committed, { unit: false })} sub="reserved by live tests" />
                  <Stat size="sm" label="Available" value={fmtUsdc(sum.available, { unit: false })} tone="good" sub="uncommitted" />
                  <Stat size="sm" label="Growth efficiency" value={`${sum.efficiency}/100`} sub="composite score" />
                </div>
              </CardBody>
              <div className="border-t border-line lg:border-l lg:border-t-0">
                <div className="px-4 pb-3 pt-4">
                  <div className="label mb-2">Allocation by category</div>
                  <StackedBar total={m.budgetMicro} parts={sum.allocation.map((a) => ({ key: a.category, label: CATEGORY_LABEL[a.category] ?? a.category, value: a.allocated, display: fmtUsdc(a.allocated, { unit: false }) }))} />
                </div>
                {sum.allocation.length > 0 ? (
                  <Table className="border-t border-line">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="text-right">Allocated</th>
                        <th className="text-right">Used</th>
                        <th className="text-right">Used %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sum.allocation.map((a) => (
                        <tr key={a.category}>
                          <td>{CATEGORY_LABEL[a.category] ?? a.category}</td>
                          <td className="num text-right">{fmtUsdc(a.allocated, { unit: false })}</td>
                          <td className="num text-right text-ink-2">{fmtUsdc(a.used, { unit: false })}</td>
                          <td className="num text-right text-ink-3">{a.allocated ? Math.round((a.used / a.allocated) * 100) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <p className="px-4 pb-4 text-[12.5px] text-ink-3">No category allocations on this mission.</p>
                )}
              </div>
            </div>
            <CardFooter>
              <span>Growth efficiency = 50% goal attainment + 30% cost efficiency vs plan + 20% experiment hit-rate.</span>
              <Link href="/app/experiments" className="inline-flex shrink-0 items-center gap-1 hover:text-ink">
                Experiments <ArrowRight className="size-3" />
              </Link>
            </CardFooter>
          </Card>
        );
      })}

      {missions.length > 0 && (
        <Card>
          <CardHeader title="Learning & reallocation" description="Compares measured CPA across experiments; stops losers and moves unspent budget to winners, through policy" icon={<Brain />} action={operate && hasActive ? <ActionButton action={runLearningAction} label="Run learning now" size="xs" logTitle="Learning run" /> : undefined} />
          {learnings.length ? (
            <ul className="divide-y divide-line">
              {learnings.map((l) => (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                    <span className="num" title={l.createdAt.toISOString()}>
                      {relTime(l.createdAt)}
                    </span>
                    <ModeBadge mode={l.dataMode} />
                    {l.decisionId && (
                      <Link href={`/app/receipts/${l.decisionId}`} className="ml-auto inline-flex items-center gap-1 hover:text-ink">
                        Receipt <ArrowRight className="size-3" />
                      </Link>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1.5 text-[12.5px] text-ink-2">
                    {(l.findings as unknown as Finding[]).map((f) => (
                      <li key={f.label} className="flex items-start gap-2">
                        <Badge tone={VERDICT_TONE(f.verdict)} className="mt-px min-w-16 justify-center">
                          {f.verdict.replace(/_/g, " ")}
                        </Badge>
                        <span>
                          <span className="font-medium text-ink">{f.label}</span> — {f.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {(l.reallocations as unknown as Realloc[]).map((r, i) => (
                    <div key={i} className="mt-2 rounded-[6px] bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink">
                      ↳ moved <span className="num">{fmtUsdc(r.amountMicro)}</span>: <span className="text-ink-2">{r.reason}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-ink-3">No learning runs yet. They run automatically each cycle once experiments have measured spend, or on demand with “Run learning now”.</CardBody>
          )}
        </Card>
      )}
    </div>
  );
}
