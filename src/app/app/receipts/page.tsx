import { desc, eq } from "drizzle-orm";
import { FileCheck2 } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Card, CardFooter, CardHeader, ModeBadge, PageHeader, Stat, StatStrip, TxStateBadge, VerdictBadge, shortHash } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";

type Body = { costMicro?: number | null; payment?: { state?: string } | null; autonomous?: boolean };
const humanize = (k: string) => k.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default async function Receipts() {
  const { project, db } = await requireProject();
  const rows = await db
    .select({ r: s.decisionReceipts, d: s.agentDecisions })
    .from(s.decisionReceipts)
    .innerJoin(s.agentDecisions, eq(s.decisionReceipts.decisionId, s.agentDecisions.id))
    .where(eq(s.decisionReceipts.projectId, project.id))
    .orderBy(desc(s.agentDecisions.number))
    .limit(500);

  const count = (v: string) => rows.filter((x) => x.d.policyVerdict === v).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Receipts"
        description="A receipt for every agent decision: what it did, why, which policy rules ran, and the payment trace. Each body carries a sha256 digest that is recomputed on view, which detects edits to the stored receipt; finalized receipts are never rewritten."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>{rows.length} receipts</span>
          </>
        }
      />

      <StatStrip className="grid-cols-2 lg:grid-cols-4">
        <Stat label="Receipts" value={rows.length} sub={`${rows.filter((x) => x.r.finalizedAt).length} finalized`} />
        <Stat label="Allowed" value={count("ALLOW")} sub="within autonomous policy" tone={count("ALLOW") ? "good" : undefined} />
        <Stat label="Needed approval" value={count("APPROVAL_REQUIRED")} sub="routed to a human" tone={count("APPROVAL_REQUIRED") ? "warn" : undefined} />
        <Stat label="Denied" value={count("DENY")} sub="blocked by a rule" tone={count("DENY") ? "bad" : undefined} />
      </StatStrip>

      <Card>
        <CardHeader title="Decision receipts" icon={<FileCheck2 />} />
        <DataTable
          searchable
          defaultSort={{ key: "number", dir: "desc" }}
          columns={[
            { key: "number", label: "Decision", sortable: true, className: "w-24" },
            { key: "kind", label: "Action", sortable: true },
            { key: "agent", label: "Agent", sortable: true },
            { key: "verdict", label: "Verdict", sortable: true },
            { key: "cost", label: "Cost", align: "right", sortable: true },
            { key: "state", label: "Outcome" },
            { key: "mode", label: "Mode", sortable: true },
            { key: "hash", label: "sha256" },
            { key: "when", label: "When", sortable: true },
          ]}
          rows={rows.map(({ r, d }) => {
            const b = r.body as Body;
            const cost = b.costMicro ?? null;
            return {
              id: r.id,
              href: `/app/receipts/${d.id}`,
              cells: {
                number: <span className="num">#{d.number}</span>,
                kind: (
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {humanize(d.kind)}
                    {!d.autonomous && <Badge tone="muted">human</Badge>}
                  </span>
                ),
                agent: <span className="text-ink-2">{d.agent}</span>,
                verdict: <VerdictBadge verdict={d.policyVerdict} />,
                cost: <span className="num">{cost != null ? fmtUsdc(cost) : <span className="text-ink-4">—</span>}</span>,
                state: b.payment?.state ? <TxStateBadge state={b.payment.state} /> : <span className="text-[11.5px] text-ink-3">{humanize(d.status)}</span>,
                mode: <ModeBadge mode={d.dataMode} />,
                hash: (
                  <code className="num text-[11px] text-ink-3" title={r.digest}>
                    {shortHash(r.digest, 5)}
                  </code>
                ),
                when: (
                  <span className="whitespace-nowrap text-ink-3" title={d.createdAt.toISOString()}>
                    {relTime(d.createdAt)}
                  </span>
                ),
              },
              sort: { number: d.number, kind: d.kind, agent: d.agent, verdict: d.policyVerdict ?? "", cost, mode: d.dataMode, when: d.createdAt.getTime() },
              search: `#${d.number} ${d.kind} ${d.agent} ${d.policyVerdict ?? ""} ${d.dataMode} ${r.digest} ${d.rationale}`,
            };
          })}
          empty={<p className="text-center text-[12.5px] text-ink-3">No receipts yet. Every decision the agents make — buying data, proposing spend, reallocating budget — writes one. Run a cycle to start.</p>}
        />
        <CardFooter>Digests are computed over the canonical JSON body; a mismatch on the detail page means the stored body was edited without updating its digest. Finalized receipts also record the previous finalized receipt’s digest.</CardFooter>
      </Card>
    </div>
  );
}
