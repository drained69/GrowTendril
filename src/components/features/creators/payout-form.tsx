"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { setKolPayoutAction } from "@/server/actions/wallet";
import { useHydrated } from "@/components/ui/submit";

const EVM = /^0x[0-9a-fA-F]{40}$/;

/** Set or clear the USDC payout address for a creator (Arc / EVM). Server validates and audits. */
export function PayoutForm({ kolId, current, disabled }: { kolId: string; current: string | null; disabled?: boolean }) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const trimmed = value.trim();
  const dirty = trimmed !== (current ?? "");
  const hydrated = useHydrated();

  return (
    <form
      method="post"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hydrated || disabled || pending || !dirty) return;
        if (trimmed && !EVM.test(trimmed)) {
          setError("Enter a 0x… EVM address (42 characters)");
          return;
        }
        setError(null);
        start(async () => {
          const r = await setKolPayoutAction(kolId, trimmed);
          if (!r.ok) {
            setError(r.error);
            toast.error("Couldn’t save payout address", r.error);
          } else {
            toast.success(r.message ?? "Saved");
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor={`payout-${kolId}`} className="block text-[12px] font-medium text-ink-2">
        Payout address
      </label>
      <div className="flex gap-2">
        <Input
          id={`payout-${kolId}`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled || pending}
          className="num text-[12px]"
          aria-invalid={!!error}
        />
        <Button type="submit" variant="secondary" icon={<Wallet />} loading={pending} disabled={!hydrated || disabled || !dirty}>
          {trimmed || !current ? "Save" : "Clear"}
        </Button>
      </div>
      {error ? (
        <p className="text-[11.5px] text-critical">{error}</p>
      ) : (
        <p className="text-[11.5px] leading-snug text-ink-3">{disabled ? "Only wallet managers can change where creators are paid." : "Provided by the creator. Payments only ever go to the address set here."}</p>
      )}
    </form>
  );
}
