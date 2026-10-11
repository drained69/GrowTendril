import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { CountUp } from "@/components/ui/count-up";

const numeric = (v: ReactNode) => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(v.trim()) ? v.trim() : null);

/** A headline number in the hand-drawn face, with a quiet label above and context below. */
export function Stat({ label, value, sub, tone, className, size = "md" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad"; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cn("group min-w-0", className)}>
      <div className="truncate text-[12px] font-medium text-ink-3">{label}</div>
      <div
        className={cn(
          "display display-bounce mt-1.5 truncate leading-none",
          size === "lg" ? "text-[38px]" : size === "sm" ? "text-[20px]" : "text-[28px]",
          tone === "good" && "text-good",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-critical",
        )}
      >
        {numeric(value) ? <CountUp text={numeric(value)!} /> : value}
      </div>
      {sub && <div className="mt-2 truncate text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** A row of stats on one rounded card, separated by hairlines — the KPI strip used at the top of pages. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid divide-line overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-card)] sm:divide-x [&>*]:px-5 [&>*]:py-4.5", className)}>{children}</div>;
}
