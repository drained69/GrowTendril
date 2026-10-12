import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import type { Metric, Recommendation, Verdict } from "@/server/domain/growth/customer-value";
import { VERDICT_LABEL } from "@/server/domain/growth/customer-value";

/**
 * A figure with its standing made visible: recorded values render plainly, estimates carry an
 * "est." tag, and anything not computable says so instead of showing a zero.
 */
export function MetricValue({ m, format, className, compact }: { m: Metric; format: (v: number) => ReactNode; className?: string; compact?: boolean }) {
  if (m.value == null)
    return (
      <span title={m.detail} className={cn("text-[11.5px] text-ink-4", className)}>
        {compact ? "Insufficient data" : <>Insufficient data<span className="block text-[11px] leading-snug">{m.detail}</span></>}
      </span>
    );
  return (
    <span title={m.detail} className={cn("num inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      {format(m.value)}
      {m.kind === "estimate" && <Badge tone="muted">est.</Badge>}
    </span>
  );
}

const VERDICT_TONE: Record<Verdict, Tone> = { continue_testing: "info", improve_funnel: "warn", stop_spending: "bad" };

export function VerdictBadge({ rec }: { rec: Recommendation }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={rec.reason}>
      <Badge tone={VERDICT_TONE[rec.verdict]} dot>
        {VERDICT_LABEL[rec.verdict]}
      </Badge>
      {rec.confidence === "early" && <Badge tone="muted">early</Badge>}
    </span>
  );
}

/** "12 / 40" with the rate, or a dash when there's no base to divide by. */
export function Ratio({ n, of, className }: { n: number; of: number; className?: string }) {
  return (
    <span className={cn("num", className)}>
      {n}
      {of > 0 && <span className="ml-1 text-[11px] text-ink-4">{Math.round((n / of) * 100)}%</span>}
    </span>
  );
}
