"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Flag, Plug, Search, UserPlus, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { ALL_NAV } from "@/components/layout/nav-config";
import { cn } from "@/components/ui/cn";
import { Kbd } from "@/components/ui/misc";
import { useModal } from "@/components/ui/use-modal";

type Cmd = { id: string; label: string; group: string; icon: LucideIcon; href: string; keywords?: string };

const ACTIONS: Cmd[] = [
  { id: "new-mission", label: "Start a new mission", group: "Actions", icon: Flag, href: "/onboarding?step=3", keywords: "goal budget" },
  { id: "connect", label: "Connect a data source", group: "Actions", icon: Plug, href: "/app/integrations", keywords: "x reddit youtube github api key" },
  { id: "invite", label: "Invite a teammate", group: "Actions", icon: UserPlus, href: "/app/team", keywords: "member" },
  { id: "wallet", label: "Fund the agent wallet", group: "Actions", icon: Wallet, href: "/app/wallet", keywords: "deposit gateway usdc" },
];

/** ⌘K launcher for navigation and common actions. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const container = useModal(open, () => onOpenChange(false));
  const items = useMemo(() => {
    const all: Cmd[] = [...ALL_NAV.map((n) => ({ id: n.href, label: n.label, group: "Go to", icon: n.icon, href: n.href, keywords: n.keywords })), ...ACTIONS];
    const t = q.trim().toLowerCase();
    return t ? all.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(t)) : all;
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      input.current?.focus();
    }
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const go = (c: Cmd) => {
    onOpenChange(false);
    router.push(c.href);
  };
  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onOpenChange(false)}>
      <div ref={container} role="dialog" aria-modal="true" aria-label="Command palette" tabIndex={-1} className="w-full max-w-xl animate-pop-in overflow-hidden rounded-[12px] border border-line-strong bg-surface shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-4 text-ink-3" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search pages and actions"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[idx] ? `${listId}-${idx}` : undefined}
            value={q}
            onChange={(e) => (setQ(e.target.value), setIdx(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.max(0, Math.min(items.length - 1, i + 1))));
              if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
              if (e.key === "Enter" && items[idx]) go(items[idx]);
              if (e.key === "Escape") onOpenChange(false);
            }}
            placeholder="Search pages and actions…"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Pages and actions" className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-ink-4">{header}</div>}
                <button id={`${listId}-${i}`} type="button" role="option" aria-selected={i === idx} tabIndex={-1} onMouseEnter={() => setIdx(i)} onClick={() => go(c)} className={cn("flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px]", i === idx ? "bg-surface-3 text-ink" : "text-ink-2")}>
                  <Icon className="size-4 text-ink-3" strokeWidth={1.75} />
                  <span className="flex-1">{c.label}</span>
                  {i === idx && <CornerDownLeft className="size-3.5 text-ink-4" />}
                </button>
              </li>
            );
          })}
          {!items.length && <li className="px-3 py-6 text-center text-[12.5px] text-ink-3">No matches</li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
