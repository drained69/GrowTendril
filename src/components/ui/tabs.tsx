"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/cn";

/** URL-driven tabs on a pill track: each tab is a link; the active one is derived from the path or a query param. */
export function LinkTabs({ tabs, param, className }: { tabs: { label: string; href: string; count?: number; value?: string }[]; param?: string; className?: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <div className={cn("max-w-full overflow-x-auto", className)}>
      <div className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-1 ring-1 ring-line">
        {tabs.map((t, i) => {
          const active = param ? (sp.get(param) ?? tabs[0].value) === t.value : path === t.href || (i > 0 && path.startsWith(t.href));
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-7.5 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-200",
                active ? "bg-surface text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.06),0_2px_6px_-2px_rgb(10_11_12/0.15)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {t.label}
              {t.count != null && <span className={cn("num rounded-full px-1.5 text-[10.5px]", active ? "bg-accent/12 text-accent" : "bg-surface-3 text-ink-3")}>{t.count}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
