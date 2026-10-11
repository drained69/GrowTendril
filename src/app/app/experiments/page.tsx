import { desc, eq } from "drizzle-orm";
import { Brain, FlaskConical, Play } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { activeMission, missionSummary } from "@/server/queries/missions";
import { launchExperimentAction, runLearningAction } from "@/server/actions/growth";
import { fmtUsdc } from "@/lib/money";
import { Badge, Card, CardFooter, CardHeader, EmptyState, LinkButton, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/features/agent/action-button";

const VERDICT_TONE = (v: string) => (v === "SCALE" ? "good" : v === "STOP" || v === "REDUCE" ? "bad" : "neutral") as "good" | "bad" | "neutral";

export default async function Experiments() {
  const { project, role, db } = await requireProject();
  const operate = can(role, "operate");
  const [exps, mission] = await Promise.all([db.select().from(s.experiments).where(eq(s.experiments.projectId, project.id)).orderBy(desc(s.experiments.number)), activeMission(db, project.id)]);
  const sum = mission ? await missionSummary(db, mission) : null;
  const perf = new Map(sum?.perf.map((p) => [p.experimentId, p]) ?? []);
  const finding = new Map(sum?.findings.map((f) => [f.experimentId, f]) ?? []);
  const running = exps.filter((x) => x.status === "running").length;
  const spent = sum?.perf.reduce((n, p) => n + p.spentMicro, 0) ?? 0;
  const conversions = sum?.perf.reduce((n, p) => n + p.conversions, 0) ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Experiments"
        description="Every dollar has a hypothesis, a success metric and a stop condition attached. Spend comes from the ledger; conversions from attribution."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            {mission ? <span>Mission: {mission.name}</span> : <span>No active mission</span>}
          </>
        }
        actions={operate && mission ? <ActionButton action={runLearningAction} label="Run learning" icon={<Brain />} logTitle="Learning run" /> : undefined}
      />

      <StatStrip className="grid-cols-2 lg:grid-cols-4">
        <Stat label="Experiments" value={exps.length} sub={`${exps.filter((x) => x.status === "proposed").length} proposed`} />
        <Stat label="Running" value={running} sub="spending against a stop condition" />
        <Stat label="Spent" value={fmtUsdc(spent, { unit: false })} sub="USDC, active mission" />
        <Stat label="Conversions" value={conversions} sub={spent && conversions ? `${fmtUsdc(Math.round(spent / conversions), { unit: false })} USDC each` : "attributed only"} />
      </StatStrip>

      {exps.length ? (
        <Card>
          <CardHeader title="All experiments" icon={<FlaskConical />} />
          <DataTable
            searchable
            defaultSort={{ key: "number", dir: "desc" }}
            columns={[
              { key: "title", label: "Experiment" },
              { key: "channel", label: "Channel", sortable: true },
              { key: "budget", label: "Budget", align: "right", sortable: true },
              { key: "spent", label: "Spent", align: "right", sortable: true },
              { key: "visits", label: "Visits", align: "right", sortable: true },
              { key: "conv", label: "Conv.", align: "right", sortable: true },
              { key: "cpa", label: "CPA", align: "right", sortable: true },
              { key: "stop", label: "Stop if" },
              { key: "verdict", label: "Verdict", sortable: true },
              { key: "status", label: "Status", sortable: true },
              { key: "act", label: "" },
            ]}
            rows={exps.map((x) => {
              const p = perf.get(x.id);
              const f = finding.get(x.id);
              return {
                id: x.id,
                href: `/app/experiments/${x.id}`,
                cells: {
                  title: (
                    <span className="block max-w-[340px]">
                      <span className="flex items-center gap-1.5">
                        <span className="num font-normal text-ink-4">#{x.number}</span>
                        <span className="truncate">{x.title}</span>
                      </span>
                      <span className="block truncate text-[11.5px] font-normal text-ink-3">{x.hypothesis}</span>
                    </span>
                  ),
                  channel: <Badge tone="muted">{x.channel}</Badge>,
                  budget: <span className="num">{fmtUsdc(x.budgetMicro, { unit: false })}</span>,
                  spent: <span className="num">{p ? fmtUsdc(p.spentMicro, { unit: false }) : "—"}</span>,
                  visits: <span className="num text-ink-2">{p?.visits ?? "—"}</span>,
                  conv: <span className="num">{p?.conversions ?? "—"}</span>,
                  cpa: <span className="num">{f?.cpaMicro != null ? fmtUsdc(f.cpaMicro, { unit: false }) : "—"}</span>,
                  stop: (
                    <span className="num whitespace-nowrap text-[11.5px] text-ink-3">
                      CPA &gt; {fmtUsdc(x.stopMaxCpaMicro, { unit: false })} after {fmtUsdc(x.stopAfterSpendMicro, { unit: false })}
                    </span>
                  ),
                  verdict: f ? <Badge tone={VERDICT_TONE(f.verdict)}>{f.verdict.replace(/_/g, " ")}</Badge> : <span className="text-ink-4">—</span>,
                  status: (
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={x.status} />
                      <ModeBadge mode={x.dataMode} />
                    </span>
                  ),
                  act: operate && x.status === "proposed" ? <ActionButton action={launchExperimentAction.bind(null, x.id, "first")} label="Launch" icon={<Play />} size="xs" logTitle={`Launch experiment #${x.number}`} /> : null,
                },
                sort: { number: x.number, channel: x.channel, budget: x.budgetMicro, spent: p?.spentMicro ?? null, visits: p?.visits ?? null, conv: p?.conversions ?? null, cpa: f?.cpaMicro ?? null, verdict: f?.verdict ?? null, status: x.status },
                search: `#${x.number} ${x.title} ${x.hypothesis} ${x.channel} ${x.status} ${f?.verdict ?? ""}`,
              };
            })}
          />
          <CardFooter>Spend and conversions are measured for the active mission only; CPA is committed spend (authorized through settled; simulated in DEMO) ÷ attributed goal conversions.</CardFooter>
        </Card>
      ) : (
        <EmptyState
          icon={<FlaskConical />}
          title="No experiments yet"
          description="GrowTendril creates them once an opportunity crosses the confidence threshold — or create one yourself from any opportunity."
          action={<LinkButton href="/app/opportunities" variant="primary">Browse opportunities</LinkButton>}
        />
      )}
    </div>
  );
}
