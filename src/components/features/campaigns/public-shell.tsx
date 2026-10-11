import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/logo";
import { cn } from "@/components/ui/cn";

/** Standalone frame for the public creator pages (join + contribution): no app shell, no account. */
export function CampaignShell({ children, eyebrow, title, description, aside, width = "default" }: { children: ReactNode; eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; aside?: ReactNode; width?: "default" | "wide" }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface/60">
        <div className={cn("mx-auto flex items-center justify-between gap-4 px-5 py-3.5", width === "wide" ? "max-w-[1120px]" : "max-w-[980px]")}>
          <Link href="/" aria-label="GrowTendril">
            <Logo />
          </Link>
          {aside && <div className="flex items-center gap-2 text-[12px] text-ink-3">{aside}</div>}
        </div>
      </header>
      <main className={cn("mx-auto px-5 py-8 sm:py-10", width === "wide" ? "max-w-[1120px]" : "max-w-[980px]")}>
        <div className="mb-6">
          {eyebrow && <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">{eyebrow}</div>}
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
          {description && <div className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{description}</div>}
        </div>
        {children}
      </main>
      <footer className="border-t border-line">
        <div className={cn("mx-auto px-5 py-4 text-[11.5px] text-ink-4", width === "wide" ? "max-w-[1120px]" : "max-w-[980px]")}>
          Creator campaigns run on GrowTendril. Rules, reviews and payouts are recorded and shown to both sides.
        </div>
      </footer>
    </div>
  );
}

/** A labelled rule line for the public pages. */
export function Rule({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[12.5px] text-ink-2">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{hint}</div>}
      </div>
      <div className="num shrink-0 text-right text-[13px] font-medium text-ink">{value}</div>
    </div>
  );
}
