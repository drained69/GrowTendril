"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Mail } from "lucide-react";
import { requestWithdrawalCodeAction, withdrawAction } from "@/server/actions/wallet";
import { Button, Callout, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";

/**
 * Owner withdrawal: amount + destination (typed twice), then an emailed code bound to exactly that
 * amount and address. Changing either after the code is sent needs a new code.
 */
export function WithdrawForm({ availableUsdc, explorer }: { availableUsdc: string; explorer: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ amount: "", to: "", toConfirm: "" });
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [codeState, requestCode, requesting] = useActionState(requestWithdrawalCodeAction, null);
  const [sendState, send, sending] = useActionState(withdrawAction, null);
  const key = `${values.amount}|${values.to.toLowerCase()}|${values.toConfirm.toLowerCase()}`;
  const codeSent = sentFor === key;

  useEffect(() => {
    if (!codeState) return;
    if (codeState.ok) {
      setSentFor(key);
      toast.success("Code sent", codeState.message);
    } else toast.error("Can't withdraw yet", codeState.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeState]);
  useEffect(() => {
    if (!sendState) return;
    if (sendState.ok) {
      toast.success("Withdrawal sent", sendState.message);
      setValues({ amount: "", to: "", toConfirm: "" });
      setSentFor(null);
      router.refresh();
    } else toast.error("Withdrawal not sent", sendState.error);
  }, [sendState, router]);

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const fields = (
    <>
      <input type="hidden" name="amount" value={values.amount} />
      <input type="hidden" name="to" value={values.to} />
      <input type="hidden" name="toConfirm" value={values.toConfirm} />
    </>
  );
  const done = sendState?.ok ? sendState.data : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Amount" htmlFor="wd-amount" hint={<button type="button" className="underline" onClick={() => setValues((v) => ({ ...v, amount: availableUsdc }))}>Max {availableUsdc} USDC</button>}>
          <Input id="wd-amount" value={values.amount} onChange={set("amount")} inputMode="decimal" placeholder="0.00" className="num" autoComplete="off" />
        </Field>
        <Field label="Send to (Arc address)" htmlFor="wd-to" hint="A wallet you control on Arc. USDC sent to a wrong address can't be recovered.">
          <Input id="wd-to" value={values.to} onChange={set("to")} placeholder="0x…" className="num text-[12px]" spellCheck={false} autoComplete="off" />
        </Field>
      </div>
      <Field label="Paste the address again" htmlFor="wd-to2">
        <Input id="wd-to2" value={values.toConfirm} onChange={set("toConfirm")} placeholder="0x…" className="num text-[12px]" spellCheck={false} autoComplete="off" onPaste={undefined} />
      </Field>
      {!codeSent ? (
        <form action={requestCode}>
          {fields}
          <Button type="submit" variant="secondary" icon={<Mail />} loading={requesting} disabled={!values.amount || !values.to || !values.toConfirm}>
            Email me a confirmation code
          </Button>
        </form>
      ) : (
        <form action={send} className="space-y-3">
          {fields}
          <Callout tone="info" title="Check your email">
            {codeState?.ok ? codeState.data?.summary : null}. The code works only for this amount and address.
          </Callout>
          <Field label="6-digit code" htmlFor="wd-code">
            <Input id="wd-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="num w-40 tracking-[0.3em]" required />
          </Field>
          <Button type="submit" variant="primary" icon={<ArrowUpRight />} loading={sending}>
            Withdraw {values.amount} USDC
          </Button>
        </form>
      )}
      {done?.txHash && (
        <p className="text-[12px] text-ink-3">
          Transaction:{" "}
          <a className="num underline" href={`${explorer}/tx/${done.txHash}`} target="_blank" rel="noreferrer">
            {done.txHash.slice(0, 10)}…{done.txHash.slice(-6)}
          </a>
        </p>
      )}
    </div>
  );
}
