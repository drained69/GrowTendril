"use client";
import Link from "next/link";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Minimal accessible dropdown: click to open, Escape/click-outside to close. */
export function Menu({ trigger, children, align = "end", className, width = 220 }: { trigger: (open: boolean) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "start" | "end"; className?: string; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerNode = trigger(open);
  const renderedTrigger = isValidElement(triggerNode) ? cloneElement(triggerNode as ReactElement<{ "aria-haspopup"?: string; "aria-expanded"?: boolean; "aria-controls"?: string; type?: string }>, { "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": open ? menuId : undefined, type: "button" }) : triggerNode;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        ref.current?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={cn("relative", className)}>
      <div onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}>{renderedTrigger}</div>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" style={{ width, maxWidth: "calc(100vw - 2rem)" }} onKeyDown={(e) => {
          if (e.key === "Tab") return setOpen(false);
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])') ?? []);
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }} className={cn("absolute top-[calc(100%+6px)] z-50 animate-pop-in overflow-hidden rounded-[16px] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]", align === "end" ? "right-0" : "left-0")}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, href, icon, danger, disabled, hint }: { children: ReactNode; onClick?: () => void; href?: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; hint?: ReactNode }) {
  const cls = cn("flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0", danger ? "text-critical hover:bg-critical/10" : "text-ink-2 hover:bg-surface-2 hover:text-ink");
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
    </>
  );
  if (href && !disabled)
    return (
      <Link role="menuitem" href={href} onClick={onClick} className={cls}>
        {body}
      </Link>
    );
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-4">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}
