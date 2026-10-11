"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { attachWalletAction, depositToGatewayAction } from "@/server/actions/wallet";
import { useHydrated } from "@/components/ui/submit";

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<Result>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Something went wrong");
        toast.error("Couldn’t complete that", r.error);
      } else {
        if (r.message) toast.success(r.message);
        onOk?.();
      }
      router.refresh();
    });
  return { pending, error, run };
}

/** Attach an existing Circle developer-controlled wallet by its UUID. */
export function AttachWalletForm({ disabled, workspaceId }: { disabled?: boolean; workspaceId: string }) {
  const [id, setId] = useState("");
  const { pending, error, run } = useRun();
  const hydrated = useHydrated();
  return (
    <form
      method="post"
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hydrated || disabled || pending || !id.trim()) return;
        run(() => attachWalletAction(id), () => setId(""));
      }}
    >
      <Field label="Circle wallet ID" htmlFor="circle-wallet-id" error={error} hint={<>A live Arc mainnet EOA under this deployment&apos;s Circle entity. Its Circle refId must match this workspace: <code className="num break-all">{workspaceId}</code>.</>}>
        <Input id="circle-wallet-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="num text-[12px]" disabled={disabled || pending} autoComplete="off" spellCheck={false} />
      </Field>
      <Button type="submit" icon={<Link2 />} loading={pending} disabled={!hydrated || disabled || !id.trim()}>
        Attach wallet
      </Button>
    </form>
  );
}

/** Move wallet USDC into Circle Gateway so x402 services can be paid by signature. */
export function DepositForm({ disabled, reason }: { disabled?: boolean; reason?: string }) {
  const [amount, setAmount] = useState("");
  const { pending, error, run } = useRun();
  const hydrated = useHydrated();
  const valid = /^\d+(?:\.\d{1,6})?$/.test(amount.trim()) && Number(amount) > 0;
  return (
    <form
      method="post"
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hydrated || disabled || pending || !valid) return;
        if (!window.confirm(`Deposit ${amount} USDC from the agent wallet into Circle Gateway on Arc mainnet?`)) return;
        run(() => depositToGatewayAction(amount), () => setAmount(""));
      }}
    >
      <Field label="Amount" htmlFor="gw-amount" error={error} hint={reason ?? "Runs approve + deposit on Arc in the background. Recorded as a founder decision with a receipt."}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input id="gw-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" className="num pr-12" disabled={disabled || pending} autoComplete="off" />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
          </div>
          <Button type="submit" variant="primary" size="md" icon={<ArrowDownToLine />} loading={pending} disabled={!hydrated || disabled || !valid}>
            Deposit
          </Button>
        </div>
      </Field>
    </form>
  );
}
