import { ArrowUpRight, Scale } from "lucide-react";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { EXCEPTION_LABEL, type ExceptionKind, type LedgerException } from "@/server/domain/reconcile/exceptions";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { ResolveExceptionForm } from "@/components/features/wallet/resolve-exception-form";

/**
 * Where the payment records and Arc disagree. Open items stay at the top of the wallet until
 * someone resolves them with a note; nothing here is corrected automatically.
 */
export function LedgerExceptions({ items, canResolve }: { items: LedgerException[]; canResolve: boolean }) {
  const open = items.filter((e) => e.status === "open");
  const resolved = items.filter((e) => e.status !== "open");
  if (!items.length) return null;
  return (
    <Card className={open.length ? "border-critical/40" : undefined}>
      <CardHeader
        title="Records vs. Arc"
        description={open.length ? "These payments don’t match what Arc shows. Nothing was corrected automatically." : "Every past mismatch has been resolved."}
        icon={<Scale />}
        action={open.length ? <Badge tone="bad">{open.length} open</Badge> : <Badge tone="good">All resolved</Badge>}
      />
      {open.length > 0 && (
        <CardBody className="divide-y divide-line p-0">
          {open.map((e) => (
            <div key={e.id} className="space-y-2 px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{EXCEPTION_LABEL[e.kind as ExceptionKind] ?? e.kind}</span>
                <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                  {e.amountMicro != null && <span className="num text-ink-2">{fmtUsdc(e.amountMicro)}</span>}
                  {relTime(e.createdAt)}
                </span>
              </div>
              <p className="break-words text-[12.5px] leading-relaxed text-ink-2">{e.detail.replace(/\s*https?:\/\/\S+$/, "")}</p>
              {e.txHash && (
                <a href={txExplorerUrl("Arc", e.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-s1 hover:underline">
                  View transaction <ArrowUpRight className="size-3" />
                </a>
              )}
              {canResolve ? <ResolveExceptionForm id={e.id} /> : <p className="text-[11.5px] text-ink-3">A wallet manager can resolve this.</p>}
            </div>
          ))}
        </CardBody>
      )}
      {resolved.length > 0 && (
        <details className="border-t border-line px-4 py-3 text-[12px]">
          <summary className="cursor-pointer text-ink-3 hover:text-ink">{resolved.length} resolved</summary>
          <ul className="mt-2 space-y-2">
            {resolved.map((e) => (
              <li key={e.id} className="text-ink-3">
                <span className="text-ink-2">{EXCEPTION_LABEL[e.kind as ExceptionKind] ?? e.kind}</span>
                {e.amountMicro != null && <span className="num"> · {fmtUsdc(e.amountMicro)}</span>} — {e.resolution} <span className="text-ink-4">({relTime(e.resolvedAt)})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
