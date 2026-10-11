import Link from "next/link";
import { and, count, desc, eq, gte, ne } from "drizzle-orm";
import { ArrowRight, Building2, CircleDollarSign, Flag, Play, Plug, Radar, Sparkles, TrendingUp, Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { activeMission, missionSummary, CATEGORY_LABEL } from "@/server/queries/missions";
import { recentDecisions, recentTransactions, spentTodayMicro } from "@/server/queries/activity";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { ARC } from "@/server/integrations/circle/config";
import { listConnections } from "@/server/integrations/vault";
import { activeJob } from "@/server/jobs/queue";
import { runCycleAction, runScanAction } from "@/server/actions/agent";
import { fmtUsdc } from "@/lib/money";
import { relTime, DAY_MS } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, Confidence, EmptyState, LinkButton, ModeBadge, PageHeader, Stat, StatusDot, TxStateBadge, Velocity, VerdictBadge, shortHash } from "@/components/ui";
import { GoalProgress, StackedBar, BarList, Sparkline } from "@/components/charts";
import { ActionButton } from "@/components/features/agent/action-button";

const more = (href: string, label = "View all") => (
  <Link href={href} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
    {label} <ArrowRight className="size-3" />
  </Link>
);

export default async function Overview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const { project, role, db } = await requireProject();
  const pid = project.id;
  const demo = project.dataMode === "DEMO";

  const [mission, wallet, connections, scanJob, cycleJob, decisions, txs, spentToday] = await Promise.all([
    activeMission(db, pid),
    getWallet(db, pid),
    listConnections(db, pid),
    activeJob(db, pid, "scan"),
    activeJob(db, pid, "cycle"),
    recentDecisions(db, pid, 7),
    recentTransactions(db, pid, 6),
    spentTodayMicro(db, pid),
  ]);
  const scanning = scanJob ?? cycleJob;
  const sum = mission ? await missionSummary(db, mission) : null;
  const [[policy], qualified, [topNarr], [topKol], issues, [counts]] = await Promise.all([
    db.select().from(s.policies).where(eq(s.policies.projectId, pid)),
    db.select().from(s.companies).where(and(eq(s.companies.projectId, pid), eq(s.companies.status, "qualified"))).orderBy(desc(s.companies.overallScore)).limit(6),
    db.select().from(s.narratives).where(and(eq(s.narratives.projectId, pid), gte(s.narratives.volume7d, 1))).orderBy(desc(s.narratives.relevance), desc(s.narratives.velocityPct)).limit(1),
    db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, pid), eq(s.opportunities.type, "KOL"), ne(s.opportunities.status, "dismissed"))).orderBy(desc(s.opportunities.overallScore)).limit(1),
    db.select().from(s.productIssues).where(and(eq(s.productIssues.projectId, pid), gte(s.productIssues.mentions7d, 3))),
    db.select({ n: count() }).from(s.evidence).where(eq(s.evidence.projectId, pid)),
  ]);
  // Sparkline is the top narrative's own clustered posts, not all project posts.
  const posts = topNarr
    ? await db
        .select({ at: s.socialPosts.publishedAt })
        .from(s.narrativePosts)
        .innerJoin(s.socialPosts, eq(s.narrativePosts.postId, s.socialPosts.id))
        .where(and(eq(s.narrativePosts.narrativeId, topNarr.id), gte(s.socialPosts.publishedAt, new Date(Date.now() - 14 * DAY_MS))))
    : [];
  const daily = Array.from({ length: 14 }, (_, i) => posts.filter((p) => Math.floor((Date.now() - p.at.getTime()) / DAY_MS) === 13 - i).length);
  const live = walletIsLive(wallet);
  const connected = connections.filter((c) => c.source === "workspace" || c.source === "platform" || c.source === "keyless").length;

  const setup = [
    { done: !!mission, label: "Set a mission", detail: "A goal and a USDC budget to work against", href: "/app/missions", icon: <Flag /> },
    { done: connected > 0, label: "Connect market sources", detail: `${connected} of ${connections.length} sources ready`, href: "/app/integrations", icon: <Plug /> },
    { done: live, label: "Create the agent wallet", detail: `${ARC.name} wallet the agent spends from`, href: "/app/wallet", icon: <CircleDollarSign /> },
    { done: (counts?.n ?? 0) > 0, label: "Run the first scan", detail: scanning ? "Scan in progress…" : "Collect evidence from connected sources", href: "/app/runs", icon: <Radar /> },
  ];
  const setupLeft = setup.filter((x) => !x.done).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        description={`${project.name} — goal, money, evidence, and what the operator decided.`}
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            {project.lastCycleAt ? <span>Last cycle {relTime(project.lastCycleAt)}</span> : <span>No cycle has run yet</span>}
          </>
        }
        actions={
          <>
            {demo && (
              <LinkButton href="/app/demo" icon={<Sparkles />}>
                Guided demo
              </LinkButton>
            )}
            {can(role, "operate") && (
              <>
                <ActionButton action={runScanAction} label="Run scan" icon={<Radar />} />
                <ActionButton
                  action={runCycleAction}
                  label="Run cycle"
                  variant="primary"
                  icon={<Play />}
                  confirm="Run the full operator loop? It scans, then may buy data and propose or make payments within your spend policy. Use Run scan to only collect evidence."
                />
              </>
            )}
          </>
        }
      />

      {welcome && !demo && (
        <Callout tone="success" title="Workspace created">
          {scanning ? "The first market scan is running in the background — evidence will appear here as it lands." : "Your workspace is ready. Finish the checklist below so the operator can work end to end."}
        </Callout>
      )}

      {!demo && setupLeft > 0 && (
        <Card>
          <CardHeader title="Get the operator running" description={`${setup.length - setupLeft} of ${setup.length} steps complete`} />
          <div className="grid divide-line sm:grid-cols-2 sm:divide-x lg:grid-cols-4">
            {setup.map((x) => (
              <Link key={x.label} href={x.href} className="group flex items-start gap-3 border-t border-line px-4 py-3.5 transition-colors first:border-t-0 hover:bg-surface-2 sm:border-t-0">
                <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-[7px] ring-1 [&_svg]:size-3.5 ${x.done ? "bg-good/10 text-good ring-good/25" : "bg-surface-2 text-ink-3 ring-line-strong"}`}>{x.icon}</span>
                <span className="min-w-0">
                  <span className={`block text-[12.5px] font-medium ${x.done ? "text-ink-3 line-through" : "text-ink"}`}>{x.label}</span>
                  <span className="block text-[11.5px] text-ink-3">{x.detail}</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {mission && sum ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title={mission.name} description={mission.goalDescription} icon={<Flag />} action={<><ModeBadge mode={mission.dataMode} /><Badge>{sum.daysLeft}d left</Badge></>} />
            <CardBody>
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="text-[11.5px] font-medium text-ink-3">Progress</div>
                  <div className="num mt-1 text-[34px] font-medium leading-none tracking-[-0.03em]">
                    {sum.achieved}
                    <span className="text-[16px] text-ink-3"> / {mission.goalTarget}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <Stat size="sm" label="Attributed" value={sum.attributed} sub="to experiments" />
                  <Stat size="sm" label="Cost / qualified" value={sum.costPerQualified ? fmtUsdc(sum.costPerQualified, { unit: false }) : "—"} sub="USDC, measured" />
                  <Stat size="sm" label="Growth efficiency" value={`${sum.efficiency}/100`} sub="composite score" />
                </div>
              </div>
              <div className="mt-4">
                <GoalProgress achieved={sum.achieved} goal={mission.goalTarget} pace={sum.pace} />
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
                  <span>Marker shows on-pace target ({Math.round(sum.pace)})</span>
                  <span className="num">{Math.round((sum.achieved / Math.max(1, mission.goalTarget)) * 100)}%</span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Budget" icon={<CircleDollarSign />} action={more("/app/wallet", "Wallet")} />
            <CardBody>
              <div className="grid grid-cols-4 gap-3">
                <Stat size="sm" label="Total" value={fmtUsdc(mission.budgetMicro, { unit: false })} />
                <Stat size="sm" label="Spent" value={fmtUsdc(sum.spent, { unit: false })} />
                <Stat size="sm" label="Committed" value={fmtUsdc(sum.committed, { unit: false })} sub="reserved + awaiting approval" />
                <Stat size="sm" label="Available" value={fmtUsdc(sum.available, { unit: false })} tone="good" />
              </div>
              <div className="mt-4">
                <StackedBar total={mission.budgetMicro} parts={sum.allocation.map((a) => ({ key: a.category, label: CATEGORY_LABEL[a.category] ?? a.category, value: a.allocated, display: fmtUsdc(a.allocated, { unit: false }) }))} />
              </div>
            </CardBody>
            <CardFooter>
              <span>
                Today <span className="num text-ink">{fmtUsdc(spentToday)}</span> of {fmtUsdc(policy?.dailySpendMicro)}
              </span>
              <span className="flex items-center gap-1.5">
                <StatusDot tone={wallet?.frozen ? "bad" : live ? "good" : "warn"} />
                {wallet?.frozen ? "Frozen" : live ? `Wallet live · ${ARC.name}` : "Simulation only"}
              </span>
            </CardFooter>
          </Card>
        </div>
      ) : (
        <EmptyState icon={<Flag />} title="No active mission" description="A mission gives the operator a measurable goal and a budget ceiling. Nothing is spent without one." action={<LinkButton href="/app/missions" variant="primary">Create mission</LinkButton>} />
      )}

      {issues.map((b) => (
        <Callout
          key={b.id}
          tone="warn"
          title={`Product issue: ${b.label}`}
          action={<LinkButton href="/app/discover?filter=feedback" size="xs" variant="ghost">Evidence</LinkButton>}
        >
          {b.mentions7d} mentions this week ({b.changePct >= 0 ? "+" : ""}
          {b.changePct}%). {b.recommendation}
        </Callout>
      ))}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Qualified customers" icon={<Building2 />} action={more("/app/customers")} />
          {qualified.length ? (
            <ul className="divide-y divide-line">
              {qualified.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/customers/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{c.name}</span>
                      <span className="num block text-[11px] text-ink-3">intent {c.intentScore} · fit {c.fitScore}</span>
                    </span>
                    <Confidence value={c.confidence} compact />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-ink-3">No qualified companies yet. Companies qualify as scans collect enough buying-intent evidence.</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Top narrative" icon={<TrendingUp />} action={more("/app/narratives")} />
          <CardBody>
            {topNarr ? (
              <Link href={`/app/narratives/${topNarr.id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold">{topNarr.label}</span>
                  <Velocity pct={topNarr.velocityPct} />
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                  <Badge tone="info">{topNarr.status}</Badge>
                  <span>
                    <span className="num">{topNarr.volume7d}</span> posts this week · relevance <span className="num">{topNarr.relevance}</span>
                  </span>
                </div>
                <div className="mt-4">
                  <div className="label mb-1.5">Narrative posts · 14 days</div>
                  <Sparkline values={daily} width={300} height={40} label="posts in this narrative" />
                </div>
              </Link>
            ) : (
              <p className="text-[12.5px] text-ink-3">No narratives yet — they form once enough related posts cluster together.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Top creator opportunity" icon={<Users />} action={more("/app/kols")} />
          <CardBody>
            {topKol ? (
              <Link href={`/app/opportunities/${topKol.id}`} className="block">
                <div className="text-[14px] font-semibold leading-snug">{topKol.title}</div>
                <ul className="mt-2.5 space-y-1.5 text-[12px] leading-snug text-ink-2">
                  {topKol.whyNow.slice(0, 3).map((w) => (
                    <li key={w} className="flex gap-2">
                      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-ink-4" />
                      {w}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between">
                  <Confidence value={topKol.confidence} />
                  <span className="num text-[11.5px] text-ink-3">est. {fmtUsdc(topKol.estimatedCostMicro)}</span>
                </div>
              </Link>
            ) : (
              <p className="text-[12.5px] text-ink-3">No open creator opportunities.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Experiment performance" description="Cost per qualified conversion, lower is better" action={more("/app/experiments", "Experiments")} />
          <CardBody>
            {sum?.findings.some((f) => f.cpaMicro != null) ? (
              <BarList
                format={(v) => fmtUsdc(v, { unit: false })}
                rows={sum.findings.filter((f) => f.cpaMicro != null).map((f) => ({ label: f.label, value: f.cpaMicro!, sub: `${f.conversions} conv · ${f.verdict}`, tone: f.verdict === "STOP" || f.verdict === "REDUCE" ? "bad" : f.verdict === "SCALE" ? "good" : undefined }))}
              />
            ) : (
              <p className="text-[12.5px] text-ink-3">No measured experiments yet.</p>
            )}
          </CardBody>
          <CardFooter>Committed spend (authorized, in flight or settled; simulated in demos) ÷ conversions attributed by referral code.</CardFooter>
        </Card>

        <Card>
          <CardHeader title="Recent agent decisions" action={more("/app/receipts", "Receipts")} />
          {decisions.length ? (
            <ul className="divide-y divide-line">
              {decisions.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/receipts/${d.id}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <span className="num pt-px text-[11px] text-ink-4">#{d.number}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[12px]">
                        <span className="font-medium text-ink">{d.kind.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
                        <span className="text-ink-4">·</span>
                        <span className="text-ink-3">{d.agent}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-1 block text-[12px] text-ink-3">{d.rationale}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <VerdictBadge verdict={d.policyVerdict} />
                      <span className="text-[10.5px] text-ink-4">{relTime(d.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-ink-3">No decisions yet — run a cycle to let the agents evaluate opportunities.</CardBody>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Payments" description="x402 nanopayments and on-chain transfers on Arc" action={more("/app/activity", "Full trace")} />
        {txs.length ? (
          <ul className="divide-y divide-line">
            {txs.map((t) => (
              <li key={t.id} className="grid grid-cols-[120px_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[12px]">
                <span className="num text-ink-3">{t.rail.replace(/_/g, " ")}</span>
                <span className="truncate text-ink-2">
                  {t.kind.replace(/_/g, " ")} · {t.settlementId ? `settlement ${shortHash(t.settlementId, 4)}` : t.txHash ? shortHash(t.txHash) : "no on-chain reference"}
                </span>
                <span className="num">{fmtUsdc(t.amountMicro)}</span>
                <span className="flex items-center gap-1.5">
                  <ModeBadge mode={t.dataMode} />
                  <TxStateBadge state={t.state} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody className="text-[12.5px] text-ink-3">No payments yet.</CardBody>
        )}
      </Card>
    </div>
  );
}
