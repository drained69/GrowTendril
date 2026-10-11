import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export function Card({ children, className, id, interactive }: { children: ReactNode; className?: string; id?: string; interactive?: boolean }) {
  return (
    <section id={id} className={cn("min-w-0 rounded-[20px] border border-line bg-surface shadow-[var(--shadow-card)] transition-[border-color,box-shadow,transform] duration-200 hover:border-line-strong", interactive && "lift", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action, icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-5 pb-2 pt-4.5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2 ring-1 ring-line [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <footer className={cn("flex items-center justify-between gap-3 rounded-b-[20px] border-t border-line bg-surface-2/50 px-5 py-3 text-[12px] text-ink-3", className)}>{children}</footer>;
}
