import { cn } from "@/components/ui/cn";

/** 0-100 horizontal score. One sequential hue; the value stays in ink. */
export function ScoreBar({ value, label, className, showValue = true }: { value: number; label?: string; className?: string; showValue?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("flex items-center gap-2.5", className)} title={label ? `${label}: ${v}/100` : `${v}/100`}>
      {label && <span className="w-40 shrink-0 truncate text-[12px] text-ink-2">{label}</span>}
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className="bar-grow absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${v}%` }} />
      </div>
      {showValue && <span className="num w-7 text-right text-[12px] text-ink">{v}</span>}
    </div>
  );
}

/** Agent confidence with the 80% commit threshold marked. */
export function Confidence({ value, compact }: { value: number; compact?: boolean }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? "bg-good" : pct >= 60 ? "bg-s1" : "bg-ink-4";
  return (
    <div className="inline-flex items-center gap-2" title={`Agent confidence ${pct}% · commit threshold 80%`}>
      <div className={cn("relative h-1.5 overflow-hidden rounded-full bg-surface-3", compact ? "w-12" : "w-20")}>
        <div className={cn("bar-grow absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink-2/70" style={{ left: "80%" }} />
      </div>
      <span className="num text-[12px] text-ink">{pct}%</span>
    </div>
  );
}

export function Progress({ value, max, marker, className }: { value: number; max: number; marker?: number; className?: string }) {
  const pct = Math.min(100, (value / Math.max(1, max)) * 100);
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface-3", className)} title={`${value} of ${max}`}>
      <div className="bar-grow absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-leaf to-accent" style={{ width: `${pct}%` }} />
      {marker != null && <div className="absolute -inset-y-px w-0.5 rounded bg-ink" style={{ left: `${Math.min(99.5, (marker / Math.max(1, max)) * 100)}%` }} title={`On-pace target ${Math.round(marker)}`} />}
    </div>
  );
}

export function Velocity({ pct }: { pct: number }) {
  return <span className={cn("num text-[12px]", pct > 0 ? "text-good" : pct < 0 ? "text-serious" : "text-ink-3")}>{pct > 0 ? "↑" : pct < 0 ? "↓" : "·"} {pct > 0 ? "+" : ""}{pct}%</span>;
}
