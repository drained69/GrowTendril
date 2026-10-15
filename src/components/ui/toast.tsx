"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

type ToastKind = "success" | "error" | "info";
type ToastAction = { label: string; href: string };
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string; action?: ToastAction };

let seq = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Fire-and-forget notifications from any client component. */
export const toast = {
  success: (title: string, description?: string) => emit("success", title, description),
  error: (title: string, description?: string, action?: ToastAction) => emit("error", title, description, action),
  info: (title: string, description?: string) => emit("info", title, description),
};
function emit(kind: ToastKind, title: string, description?: string, action?: ToastAction) {
  const t = { id: ++seq, kind, title, description, action };
  listeners.forEach((l) => l(t));
}

const ICON = { success: <CheckCircle2 className="text-good" />, error: <OctagonAlert className="text-critical" />, info: <Info className="text-s1" /> };

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.kind === "error" ? 7000 : 4500);
    };
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex animate-slide-up gap-3 rounded-[16px] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-pop)]">
          <span className="mt-px shrink-0 [&_svg]:size-4">{ICON[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">{t.title}</div>
            {t.description && <div className="mt-0.5 break-words text-[12px] leading-snug text-ink-3">{t.description}</div>}
            {t.action && <Link href={t.action.href} onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} className="mt-2 inline-block text-[12px] font-medium text-accent underline underline-offset-2">{t.action.label}</Link>}
          </div>
          <button aria-label="Dismiss" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} className="shrink-0 text-ink-4 hover:text-ink [&_svg]:size-3.5">
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
