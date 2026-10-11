"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/misc";

const GO: Record<string, [string, string]> = {
  o: ["/app", "Overview"],
  d: ["/app/discover", "Discover"],
  c: ["/app/customers", "Customers"],
  n: ["/app/narratives", "Narratives"],
  k: ["/app/kols", "Creators"],
  p: ["/app/opportunities", "Opportunities"],
  e: ["/app/experiments", "Experiments"],
  w: ["/app/wallet", "Wallet"],
  a: ["/app/approvals", "Approvals"],
  s: ["/app/settings", "Settings"],
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** "?" opens the cheat sheet; "g" then a letter jumps between sections. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if ((e.target as HTMLElement | null)?.closest('[aria-modal="true"]')) return;
      if (e.key === "?") return setOpen((o) => !o);
      if (e.key === "g") return void (armed = Date.now());
      if (armed && Date.now() - armed < 1200 && GO[e.key]) {
        armed = 0;
        router.push(GO[e.key][0]);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("gt-shortcuts", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("gt-shortcuts", onOpen);
    };
  }, [router]);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" description="Move around without leaving the keyboard.">
      <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <Row keys={["⌘", "K"]} join="+" label="Search or jump to…" />
        <Row keys={["?"]} label="Show this sheet" />
        <Row keys={["Esc"]} label="Close any dialog" />
        {Object.entries(GO).map(([k, [, label]]) => (
          <Row key={k} keys={["G", k.toUpperCase()]} label={`Go to ${label}`} />
        ))}
      </div>
    </Dialog>
  );
}

function Row({ keys, label, join = "then" }: { keys: string[]; label: string; join?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 text-[12.5px] text-ink-2">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[10px] text-ink-4">{join}</span>}
            <Kbd>{k}</Kbd>
          </span>
        ))}
      </span>
    </div>
  );
}
