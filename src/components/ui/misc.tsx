import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { LogoMark } from "@/components/layout/logo";

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("group glow-mint relative flex flex-col items-center justify-center overflow-hidden rounded-[20px] border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      <LogoMark size={190} className="pointer-events-none absolute -bottom-10 -right-8 text-accent opacity-[0.06] transition-transform duration-700 group-hover:-rotate-6" />
      {icon && (
        <div className="relative mb-4 grid size-11 place-items-center rounded-full bg-surface text-accent shadow-[var(--shadow-card)] ring-1 ring-line [&_svg]:size-5">
          <span className="absolute inset-0 rounded-full bg-accent/15" style={{ animation: "ring-out 2.6s ease-out infinite" }} />
          <span className="relative">{icon}</span>
        </div>
      )}
      <div className="display display-bounce text-[18px] text-ink">{title}</div>
      {description && <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-3">{description}</div>}
      {action && <div className="mt-5 flex gap-2">{action}</div>}
    </div>
  );
}

const CALLOUT = {
  info: { cls: "border-s1/25 bg-s1/[0.06]", icon: <Info className="text-s1" /> },
  warn: { cls: "border-warning/30 bg-warning/[0.06]", icon: <AlertTriangle className="text-warning" /> },
  danger: { cls: "border-critical/30 bg-critical/[0.06]", icon: <OctagonAlert className="text-critical" /> },
  success: { cls: "border-good/30 bg-good/[0.06]", icon: <CheckCircle2 className="text-good" /> },
};

export function Callout({ tone = "info", title, children, action, className }: { tone?: keyof typeof CALLOUT; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const c = CALLOUT[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("flex flex-wrap gap-3 rounded-[14px] border px-4 py-3.5 text-[13px]", c.cls, className)}>
      <span className="mt-px shrink-0 [&_svg]:size-4">{c.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children && <div className={cn("leading-relaxed text-ink-2", !!title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function KeyValue({ items, className }: { items: { k: ReactNode; v: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-[12px] text-ink-3">{it.k}</dt>
          <dd className="min-w-0 text-right text-[12.5px] text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function Avatar({ name, size = 24, className, square }: { name: string; size?: number; className?: string; square?: boolean }) {
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span className={cn("inline-grid shrink-0 place-items-center font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]", square ? "rounded-[9px]" : "rounded-full", className)} style={{ width: size, height: size, fontSize: size * 0.4, background: `oklch(0.52 0.12 ${hue})` }}>
      {initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] border border-line-strong bg-surface px-1.5 text-[10.5px] text-ink-3 shadow-[0_1px_0_var(--color-line-strong)]">{children}</kbd>;
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("text-accent underline decoration-accent/30 underline-offset-3 transition-colors hover:decoration-accent", className)}>
      {children}
      <span aria-hidden> ↗</span>
    </a>
  );
}

export function shortHash(h?: string | null, n = 6): string {
  if (!h) return "—";
  return h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
}
