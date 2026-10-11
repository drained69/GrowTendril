import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Braces, CheckCircle2, FileCheck2, Fingerprint, Lightbulb, Route, ShieldCheck, XCircle } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { canonicalJson, sha256 } from "@/server/lib/ids";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { fmtUsdc } from "@/lib/money";
import { Badge, Callout, Card, CardBody, CardHeader, ExternalLink, KeyValue, ModeBadge, PageHeader, StatusBadge, TxStateBadge, VerdictBadge, shortHash } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";

type Body = {
  decision: number;
  agent: string;
  action: string;
  structuredAction: Record<string, unknown>;
  service: { vendor: string; source: string; resource: string } | null;
  costMicro: number | null;
  why: { rationale: string; reasons: string[] };
  policy: { verdict: string; checks: { rule: string; passed: boolean; detail: string }[] } | null;
  approval: { status: string; resolvedAt: string | null; approvedMicro: number | null; note: string | null } | null;
  status: string;
  autonomous: boolean;
  result: Record<string, unknown> | null;
  confidence: { before: number; after: number | null } | null;
  payment: { rail: string; network: string; destination: string | null; state: string; settlementId: string | null; settlementStatus: string | null; txHash: string | null; batchTxHash: string | null; explorerUrl: string | null; responseDigest: string | null; trail: { from: string | null; to: string; at: string; note: string | null }[] } | null;
  dataMode: string;
  createdAt: string;
};

const RAIL: Record<string, string> = { gateway_x402: "Circle Gateway · x402", app_kit_send: "Arc App Kit · Send", app_kit_bridge: "Arc App Kit · Bridge", gateway_deposit: "Circle Gateway · deposit" };
const humanize = (k: string) => k.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const NETWORK_KEY: Record<string, string> = { "Arc Mainnet": "Arc", "Arc Testnet": "Arc_Testnet", "Base Sepolia": "Base_Sepolia", "Arbitrum Sepolia": "Arbitrum_Sepolia", "Ethereum Sepolia": "Ethereum_Sepolia" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, db } = await requireProject();
  const [r] = await db.select().from(s.decisionReceipts).where(and(eq(s.decisionReceipts.decisionId, id), eq(s.decisionReceipts.projectId, project.id)));
  if (!r) notFound();
  const b = r.body as unknown as Body;
  const intact = sha256(canonicalJson(r.body)) === r.digest;
  const status = b.payment?.state ?? b.status;
  const p = b.payment;
  const chainKey = p ? (NETWORK_KEY[p.network] ?? p.network) : "Arc";
  const txUrl = p?.txHash ? (p.explorerUrl ?? txExplorerUrl(chainKey, p.txHash)) : null;
  const passed = b.policy?.checks.filter((c) => c.passed).length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[
          { label: "Receipts", href: "/app/receipts" },
          { label: `#${b.decision}`, href: `/app/receipts/${id}` },
        ]}
        title={
          <>
            {humanize(b.action)} <span className="num font-normal text-ink-4">#{b.decision}</span>
          </>
        }
        description={b.why.rationale}
        meta={
          <>
            <ModeBadge mode={b.dataMode} />
            {b.payment ? <TxStateBadge state={status} /> : <StatusBadge status={status} />}
            <span>by the {b.agent} agent</span>
            <span className="text-ink-4">·</span>
            <span className="num">{b.createdAt.replace("T", " ").slice(0, 19)} UTC</span>
          </>
        }
        actions={
          <Badge tone={intact ? "good" : "bad"} className="h-6 px-2 text-[11.5px]">
            {intact ? <ShieldCheck className="size-3.5" /> : <XCircle className="size-3.5" />}
            {intact ? "Digest verified" : "Digest mismatch"}
          </Badge>
        }
      />

      {!intact && (
        <Callout tone="danger" title="This receipt was modified after it was written">
          The sha256 of the stored body no longer matches the recorded digest. Treat its contents as untrusted.
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Receipt" icon={<FileCheck2 />} />
            <CardBody>
              <KeyValue
                items={[
                  { k: "Action", v: humanize(b.action) },
                  ...(b.service ? [{ k: "Service", v: <span>{b.service.vendor} <span className="text-ink-3">({b.service.source === "circle_marketplace" ? "Circle Agent Marketplace" : "bundled x402 seller"})</span></span> }] : []),
                  ...(b.service?.resource ? [{ k: "Resource", v: <span className="num block max-w-[420px] truncate text-[11.5px] text-ink-2">{b.service.resource}</span> }] : []),
                  ...(b.costMicro != null ? [{ k: "Cost", v: <span className="num">{fmtUsdc(b.costMicro)}</span> }] : []),
                  { k: "Status", v: b.payment ? <TxStateBadge state={status} /> : <StatusBadge status={status} /> },
                  { k: "Autonomy", v: b.autonomous ? "Autonomously approved by policy" : b.approval ? `Founder ${b.approval.status}` : "Human-initiated" },
                  ...(b.approval?.approvedMicro != null ? [{ k: "Approved amount", v: <span className="num">{fmtUsdc(b.approval.approvedMicro)}</span> }] : []),
                  ...(b.approval?.note ? [{ k: "Approver note", v: <span className="text-ink-2">{b.approval.note}</span> }] : []),
                  ...(b.confidence ? [{ k: "Confidence", v: <span className="num">{Math.round(b.confidence.before * 100)}% → {b.confidence.after != null ? `${Math.round(b.confidence.after * 100)}%` : "…"}</span> }] : []),
                  ...(b.result && "summary" in b.result ? [{ k: "Result", v: <span className="text-ink-2">{String(b.result.summary)}</span> }] : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Why" icon={<Lightbulb />} />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink">{b.why.rationale}</p>
              {b.why.reasons.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
                  {b.why.reasons.map((x, ix) => (
                    <li key={`${ix}:${x}`} className="flex gap-2">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4" />
                      {x}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {b.policy && (
            <Card>
              <CardHeader title="Policy evaluation" description={`${passed} of ${b.policy.checks.length} rules passed`} icon={<ShieldCheck />} action={<VerdictBadge verdict={b.policy.verdict} />} />
              <ul className="divide-y divide-line">
                {b.policy.checks.map((c) => (
                  <li key={c.rule} className="grid grid-cols-[16px_minmax(0,200px)_1fr] items-start gap-3 px-4 py-2 text-[12px]">
                    {c.passed ? <CheckCircle2 className="mt-px size-3.5 text-good" /> : <XCircle className="mt-px size-3.5 text-warning" />}
                    <span className="num truncate text-ink">{c.rule}</span>
                    <span className="text-ink-3">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Action details" description="The request checked against your spending rules" icon={<Braces />} />
            <CardBody>
              <pre className="num overflow-x-auto rounded-[8px] border border-line bg-bg px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(b.structuredAction, null, 2)}</pre>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          {p && (
            <Card>
              <CardHeader title="Payment trace" icon={<Route />} action={<TxStateBadge state={p.state} />} />
              <CardBody className="space-y-4">
                <KeyValue
                  items={[
                    { k: "Rail", v: RAIL[p.rail] ?? p.rail },
                    { k: "Network", v: `${p.network}${p.destination ? ` → ${p.destination}` : ""}` },
                    { k: "Settlement ID", v: p.settlementId ? <span className="num text-[11.5px]" title={p.settlementId}>{shortHash(p.settlementId, 6)}</span> : "—" },
                    { k: "Gateway status", v: p.settlementStatus ?? "—" },
                    { k: "Tx hash", v: p.txHash && txUrl ? <ExternalLink href={txUrl} className="num text-[11.5px]">{shortHash(p.txHash)}</ExternalLink> : "—" },
                    { k: "Arc batch tx", v: p.batchTxHash ? <ExternalLink href={txExplorerUrl(chainKey, p.batchTxHash)} className="num text-[11.5px]">{shortHash(p.batchTxHash)}</ExternalLink> : "—" },
                    ...(p.responseDigest ? [{ k: "Response sha256", v: <span className="num text-[11px]" title={p.responseDigest}>{shortHash(p.responseDigest, 8)}</span> }] : []),
                  ]}
                />
                {p.trail.length > 0 && (
                  <div>
                    <div className="label mb-2">State machine</div>
                    <ol className="relative space-y-2.5 border-l border-line pl-4">
                      {p.trail.map((t, i) => (
                        <li key={i} className="relative text-[12px]">
                          <span className={`absolute -left-[20.5px] top-[5px] size-2 rounded-full ring-2 ring-surface ${i === p.trail.length - 1 ? "bg-s1" : "bg-ink-4"}`} />
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="num text-ink">
                              <span className="text-ink-3">{t.from ?? "∅"}</span> → {t.to}
                            </span>
                            <span className="num text-[11px] text-ink-4">{t.at.slice(11, 19)}</span>
                          </div>
                          {t.note && <div className="mt-0.5 text-[11.5px] text-ink-3">{t.note}</div>}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {status === "SIMULATED" && (
                  <Callout tone="warn" title="Simulated">
                    No wallet was configured, so no funds moved and there is no settlement ID or hash. Set up the workspace wallet to run this for real.
                  </Callout>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Integrity" description="sha256 of the canonical receipt body, recomputed on every view" icon={<Fingerprint />} action={<Badge tone={intact ? "good" : "bad"}>{intact ? "Verified" : "Mismatch"}</Badge>} />
            <CardBody className="space-y-2">
              <CopyField value={r.digest} />
              <p className="text-[11.5px] text-ink-3">{r.finalizedAt ? "Finalized — the payment reached a terminal state." : "Open — the receipt is rewritten as the payment progresses."}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
