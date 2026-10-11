import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ChevronRight, Clock, ListTree, Radar, Settings2, Workflow } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { priced } from "@/server/domain/billing";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { recentJobs } from "@/server/jobs/queue";
import { AUTOPILOT_LABEL } from "@/server/jobs/scheduler";
import { runCycleAction } from "@/server/actions/agent";
import { relTime } from "@/lib/time";
import { Badge, Card, CardHeader, LinkButton, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge, StatusDot } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/features/agent/action-button";
import { AgentLog } from "@/components/features/agent/agent-log";

const KIND_LABEL: Record<string, string> = { cycle: "Operator cycle", settlements: "Settlement check", gateway_deposit: "Gateway deposit", cleanup: "Cleanup" };
const TRIGGER_LABEL: Record<string, string> = { system: "System", user: "Manual", schedule: "Autopilot", manual: "Manual", demo: "Demo" };

function duration(a: Date | null, b: Date | null): string {
  if (!a || !b) return "—";
  const ms = b.getTime() - a.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function until(d: Date): string {
  const s = Math.max(0, Math.round((d.getTime() - Date.now()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.ceil(s / 60)}m` : `${Math.ceil(s / 3600)}h`;
}

/** A job that finished without doing its work (e.g. no credit for a scan) records why. */
const skippedReason = (j: { result: unknown }) => {
  const r = j.result as { skipped?: unknown } | null;
  return typeof r?.skipped === "string" ? r.skipped : null;
};

export default async function Runs() {
  const { project, role, db } = await requireProject();
  const pid = project.id;
  const [jobs, runs] = await Promise.all([recentJobs(db, pid, 100), db.select().from(s.agentRuns).where(eq(s.agentRuns.projectId, pid)).orderBy(desc(s.agentRuns.startedAt)).limit(20)]);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const failed = jobs.filter((j) => j.status === "failed");
  const autopilot = project.autopilot ?? "off";
  const autopilotOn = autopilot !== "off";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agent runs"
        description="Background jobs and operator cycles: what ran, why it was triggered, how long it took, and every step the agents logged."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            {project.lastCycleAt ? <span>Last cycle {relTime(project.lastCycleAt)}</span> : <span>No cycle has run yet</span>}
          </>
        }
        actions={can(role, "operate") && <ActionButton action={runCycleAction} label={priced("Run cycle", "scan")} variant="primary" icon={<Radar />} />}
      />

      <StatStrip className="grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-medium text-ink-3">Autopilot</div>
          <div className="mt-1 flex items-center gap-2">
            <StatusDot tone={autopilotOn ? "good" : "idle"} pulse={autopilotOn} />
            <span className="truncate text-[17px] font-medium tracking-[-0.02em]">{AUTOPILOT_LABEL[autopilot] ?? autopilot}</span>
          </div>
          <Link href="/app/settings#autopilot" className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink">
            <Settings2 className="size-3" /> Change cadence
          </Link>
        </div>
        <Stat label="In progress" value={active.length} sub={active.length ? `${active.filter((j) => j.status === "running").length} running · ${active.filter((j) => j.status === "queued").length} queued` : "queue idle"} />
        <Stat label="Failed" value={failed.length} tone={failed.length ? "bad" : undefined} sub={`of the last ${jobs.length} jobs`} />
        <Stat label="Operator runs" value={runs.length} sub={runs[0] ? `latest ${relTime(runs[0].startedAt)}` : "none yet"} />
      </StatStrip>

      <Card>
        <CardHeader title="Jobs" description="The durable queue — retried with backoff until max attempts" icon={<Workflow />} />
        <DataTable
          searchable={jobs.length > 10}
          defaultSort={{ key: "created", dir: "desc" }}
          columns={[
            { key: "kind", label: "Job", sortable: true },
            { key: "trigger", label: "Trigger", sortable: true },
            { key: "status", label: "Status", sortable: true },
            { key: "attempts", label: "Attempts", align: "right", sortable: true },
            { key: "created", label: "Created", sortable: true },
            { key: "finished", label: "Finished", sortable: true },
            { key: "duration", label: "Duration", align: "right" },
            { key: "error", label: "Last error" },
          ]}
          rows={jobs.map((j) => ({
            id: j.id,
            cells: {
              kind: (
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{KIND_LABEL[j.kind] ?? j.kind}</span>
                  <span className="num text-[11px] text-ink-4">{j.id.slice(0, 8)}</span>
                </span>
              ),
              trigger: <Badge tone={j.trigger === "schedule" ? "info" : j.trigger === "user" ? "accent" : "muted"}>{TRIGGER_LABEL[j.trigger] ?? j.trigger}</Badge>,
              status: skippedReason(j) ? <Badge tone="warn">Skipped</Badge> : <StatusBadge status={j.status} />,
              attempts: (
                <span className={`num ${j.attempts > 1 ? "text-warning" : "text-ink-2"}`}>
                  {j.attempts}/{j.maxAttempts}
                </span>
              ),
              created: (
                <span className="whitespace-nowrap text-ink-3" title={j.createdAt.toISOString()}>
                  {relTime(j.createdAt)}
                </span>
              ),
              finished: j.finishedAt ? (
                <span className="whitespace-nowrap text-ink-3" title={j.finishedAt.toISOString()}>
                  {relTime(j.finishedAt)}
                </span>
              ) : j.status === "queued" && j.runAt.getTime() > Date.now() ? (
                <span className="flex items-center gap-1 whitespace-nowrap text-[11.5px] text-ink-3">
                  <Clock className="size-3" /> retry in {until(j.runAt)}
                </span>
              ) : (
                <span className="text-ink-4">—</span>
              ),
              duration: <span className="num text-ink-3">{duration(j.startedAt, j.finishedAt)}</span>,
              error: skippedReason(j) ? (
                <span className="flex items-center gap-1.5 text-[11.5px] text-warning">
                  {skippedReason(j) === "balance too low" ? (
                    <>
                      Balance too low ·{" "}
                      <Link href="/billing" className="underline underline-offset-2">
                        top up
                      </Link>
                    </>
                  ) : (
                    `Skipped: ${skippedReason(j)}`
                  )}
                </span>
              ) : j.lastError ? (
                <span className="block max-w-[320px] truncate text-[11.5px] text-critical" title={j.lastError}>
                  {j.lastError}
                </span>
              ) : (
                <span className="text-ink-4">—</span>
              ),
            },
            sort: { kind: j.kind, trigger: j.trigger, status: j.status, attempts: j.attempts, created: j.createdAt.getTime(), finished: j.finishedAt?.getTime() ?? null },
            search: `${KIND_LABEL[j.kind] ?? j.kind} ${j.trigger} ${j.status} ${skippedReason(j) ?? ""} ${j.lastError ?? ""} ${j.id}`,
          }))}
          empty={<p className="text-center text-[12.5px] text-ink-3">No jobs yet. “Run cycle”, autopilot, settlement checks and Gateway deposits all appear here as they’re queued.</p>}
        />
      </Card>

      <Card>
        <CardHeader title="Operator runs" description="Each cycle’s step-by-step agent log — expand a run to read it" icon={<ListTree />} />
        {runs.length ? (
          <ul className="divide-y divide-line">
            {runs.map((r) => {
              const stats = Object.entries(r.stats ?? {}).filter(([, v]) => typeof v === "number" || typeof v === "string").slice(0, 6);
              return (
                <li key={r.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-3.5 shrink-0 text-ink-4 transition-transform group-open:rotate-90" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[12.5px]">
                          <span className="font-medium text-ink">{TRIGGER_LABEL[r.trigger] ?? r.trigger} run</span>
                          <span className="num text-ink-3">{r.log.length} steps</span>
                          {r.finishedAt && <span className="num text-ink-4">· {duration(r.startedAt, r.finishedAt)}</span>}
                        </span>
                        {stats.length > 0 && (
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                            {stats.map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${v}`).join(" · ")}
                          </span>
                        )}
                      </span>
                      <StatusBadge status={r.status} />
                      <span className="w-16 shrink-0 text-right text-[11.5px] text-ink-4" title={r.startedAt.toISOString()}>
                        {relTime(r.startedAt)}
                      </span>
                    </summary>
                    <div className="px-4 pb-4 pl-10">
                      <AgentLog log={r.log} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-[12.5px] text-ink-3">
            <span>No operator runs yet — run a cycle now, or turn on autopilot so the operator scans on a schedule.</span>
            <LinkButton href="/app/settings#autopilot" size="xs" icon={<Settings2 />}>
              Autopilot settings
            </LinkButton>
          </div>
        )}
      </Card>
    </div>
  );
}
