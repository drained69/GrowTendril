import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent" | "muted";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 ring-line-strong/70",
  muted: "bg-transparent text-ink-3 ring-line",
  good: "bg-good/10 text-good ring-good/20",
  warn: "bg-warning/10 text-warning ring-warning/20",
  bad: "bg-critical/10 text-critical ring-critical/25",
  info: "bg-s1/10 text-s1 ring-s1/20",
  accent: "bg-s7/10 text-s7 ring-s7/20",
};

export function Badge({ children, tone = "neutral", className, dot }: { children: ReactNode; tone?: Tone; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium ring-1 ring-inset", TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const MODE: Record<string, { tone: Tone; title: string }> = {
  DEMO: { tone: "accent", title: "Fictional seeded data" },
  SIMULATED: { tone: "warn", title: "Would have happened — nothing moved" },
  TESTNET: { tone: "info", title: "Real Circle / Arc Testnet activity" },
  LIVE: { tone: "good", title: "Real public data" },
};

/** Provenance label carried by every user-visible record. */
export function ModeBadge({ mode, className }: { mode: string | null | undefined; className?: string }) {
  if (!mode) return null;
  const m = MODE[mode] ?? { tone: "neutral" as Tone, title: mode };
  return (
    <span title={m.title}>
      <Badge tone={m.tone} className={cn("num tracking-wide", className)}>
        {mode}
      </Badge>
    </span>
  );
}

const VERDICT: Record<string, Tone> = { ALLOW: "good", APPROVAL_REQUIRED: "warn", DENY: "bad" };
export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <span className="text-ink-4">—</span>;
  return <Badge tone={VERDICT[verdict] ?? "neutral"}>{verdict === "APPROVAL_REQUIRED" ? "Approval" : verdict === "ALLOW" ? "Allow" : "Deny"}</Badge>;
}

const TX: Record<string, Tone> = { SETTLED: "good", SUBMITTED: "info", EXECUTING: "info", AUTHORIZED: "info", AWAITING_APPROVAL: "warn", SIMULATED: "warn", FAILED: "bad", DENIED: "bad", REJECTED: "bad", PROPOSED: "neutral" };
const TX_LABEL: Record<string, string> = { AWAITING_APPROVAL: "Awaiting approval" };
export function TxStateBadge({ state }: { state: string }) {
  return (
    <Badge tone={TX[state] ?? "neutral"} dot={state === "SUBMITTED" || state === "EXECUTING"}>
      {TX_LABEL[state] ?? state.charAt(0) + state.slice(1).toLowerCase()}
    </Badge>
  );
}

const STATUS: Record<string, Tone> = {
  running: "info",
  queued: "neutral",
  done: "good",
  completed: "good",
  failed: "bad",
  proposed: "neutral",
  awaiting_approval: "warn",
  stopped: "bad",
  succeeded: "good",
  open: "info",
  experiment: "accent",
  dismissed: "muted",
  qualified: "good",
  candidate: "neutral",
  active: "good",
  paused: "muted",
  pending: "warn",
  approved: "good",
  rejected: "bad",
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS[status] ?? "neutral"} dot={status === "running"}>
      {label ?? status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

export function StatusDot({ tone, pulse, className }: { tone: "good" | "warn" | "bad" | "idle" | "info"; pulse?: boolean; className?: string }) {
  const c = { good: "bg-good", warn: "bg-warning", bad: "bg-critical", idle: "bg-ink-4", info: "bg-s1" }[tone];
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", c, pulse && "pulse", className)} />;
}
