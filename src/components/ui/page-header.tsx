import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, crumbs, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href: string }[]; meta?: ReactNode }) {
  return (
    <div className="mb-8">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]">
          {crumbs.map((c) => (
            <Link key={c.href} href={c.href} className="eyebrow transition-opacity hover:opacity-75">
              {c.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="display display-bounce flex flex-wrap items-center gap-2.5 text-[clamp(1.9rem,3.2vw,2.5rem)] leading-[1.1] text-ink">{title}</h1>
          {description && <p className="mt-2.5 max-w-2xl text-[14.5px] leading-relaxed text-ink-3">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3.5 mt-10 flex items-center justify-between first:mt-0">
      <h2 className="display text-[19px] text-ink">{children}</h2>
      {action}
    </div>
  );
}
