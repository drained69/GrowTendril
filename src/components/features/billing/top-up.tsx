"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createTopUpAction, devTopUpAction } from "@/server/actions/billing";
import { Button, cn } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { MAX_TOPUP_USDC, MIN_TOPUP_USDC, TOPUP_PRESETS_USDC } from "@/lib/services";
import { useHydrated } from "@/components/ui/submit";

type Mode = "arc" | "dev";

function useTopUp(mode: Mode) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (usdc: number) =>
    start(async () => {
      // On Arc, creating the invoice redirects to its payment page; a result only comes back on failure.
      const r = await (mode === "arc" ? createTopUpAction(usdc) : devTopUpAction(usdc));
      if (r && !r.ok) toast.error("Couldn’t start the top-up", r.error);
      else if (r?.message) toast.success(r.message);
      router.refresh();
    });
  return { pending, run };
}

/** Pick or type an amount, then pay it in USDC on Arc (or, in development, credit it for free). */
export function TopUpForm({ mode, suggested }: { mode: Mode; suggested?: number }) {
  const [amount, setAmount] = useState(String(suggested ?? TOPUP_PRESETS_USDC[1]));
  const { pending, run } = useTopUp(mode);
  const hydrated = useHydrated();
  const n = Number(amount);
  const valid = /^\d+(?:\.\d{1,2})?$/.test(amount) && Number.isFinite(n) && n >= MIN_TOPUP_USDC && n <= MAX_TOPUP_USDC;
  return (
    <form
      method="post"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (hydrated && valid && !pending) run(n);
      }}
    >
      <div className="grid grid-cols-4 gap-2">
        {TOPUP_PRESETS_USDC.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => setAmount(String(p))}
            className={cn("display h-11 rounded-full border text-[16px] transition-[background-color,border-color,transform,color] duration-200 ease-[cubic-bezier(0.3,1.6,0.5,1)] hover:-translate-y-0.5 active:scale-[0.95]", Number(amount) === p ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2")}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
          <span className="text-[12px] text-ink-3">Amount</span>
          <input
            inputMode="decimal"
            disabled={pending}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Top-up amount in USDC"
            className="num min-w-0 flex-1 bg-transparent text-right text-[14px] text-ink outline-none"
          />
          <span className="num text-[12px] text-ink-3">USDC</span>
        </label>
        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={!hydrated || !valid}>
          {mode === "arc" ? "Pay on Arc" : "Add credit"}
          {!pending && <ArrowRight />}
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-3">
        {valid ? `Any amount from ${MIN_TOPUP_USDC} USDC. Credit never expires.` : `Enter between ${MIN_TOPUP_USDC} and ${MAX_TOPUP_USDC.toLocaleString("en-US")} USDC, up to two decimals.`}
        {mode === "dev" && " Development: credit is added for free, no USDC moves."}
      </p>
    </form>
  );
}

export function TopUpButton({ usdc, mode, label }: { usdc: number; mode: Mode; label: string }) {
  const { pending, run } = useTopUp(mode);
  return (
    <Button variant="primary" size="lg" className="w-full" loading={pending} onClick={() => run(usdc)}>
      {label}
      {!pending && <ArrowRight />}
    </Button>
  );
}
