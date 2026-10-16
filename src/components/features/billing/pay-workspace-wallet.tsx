"use client";

import { useState, useTransition } from "react";
import { Mail, Wallet } from "lucide-react";
import { payWalletInvoiceAction, requestWalletInvoiceCodeAction } from "@/server/actions/billing";
import { Button, Callout, Field, Input } from "@/components/ui";
import { fmtUsdc } from "@/lib/money";

/** A deliberate, owner-confirmed transfer from the selected workspace wallet into billing credit. */
export function PayWorkspaceWallet({ invoiceId, amountMicro, availableMicro, balanceMicro }: { invoiceId: string; amountMicro: number; availableMicro: number; balanceMicro: number }) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, start] = useTransition();
  const enough = availableMicro >= amountMicro;

  const requestCode = () => start(async () => {
    setError(null);
    const result = await requestWalletInvoiceCodeAction(invoiceId);
    if (!result.ok) return setError(result.error);
    setCodeSent(true);
    setMessage(result.message ?? "Confirmation code sent.");
  });

  const pay = () => start(async () => {
    setError(null);
    const result = await payWalletInvoiceAction(invoiceId, code);
    if (!result.ok) return setError(result.error);
    setSent(true);
    setMessage(result.message ?? "Payment submitted. Checking Arc.");
  });

  return (
    <div className="space-y-3 rounded-[14px] border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Wallet className="size-4" /> Pay from workspace wallet</div>
      <p className="text-[12px] leading-relaxed text-ink-3">
        Move exactly {fmtUsdc(amountMicro)} from this workspace&apos;s Circle wallet to GrowTendril billing. You&apos;ll approve the transfer with an email code. Credit appears only after Arc confirms it.
      </p>
      <p className="text-[12px] text-ink-2">Wallet: <span className="num">{fmtUsdc(balanceMicro)}</span> · Available after fee reserve: <span className="num">{fmtUsdc(availableMicro)}</span></p>
      {!enough && <Callout tone="warn">Add at least {fmtUsdc(amountMicro - availableMicro)} to your workspace wallet, or pay from another wallet below. The wallet keeps 0.05 USDC for Arc network fees.</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}
      {message && <Callout tone="info">{message}</Callout>}
      {!sent && !codeSent && <Button type="button" variant="secondary" icon={<Mail />} loading={busy} disabled={!enough} onClick={requestCode}>Email me a payment code</Button>}
      {!sent && codeSent && <div className="space-y-2">
        <Field label="6-digit code" htmlFor="wallet-invoice-code"><Input id="wallet-invoice-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="num w-40 tracking-[0.3em]" /></Field>
        <Button type="button" variant="primary" loading={busy} disabled={code.length !== 6} onClick={pay}>Confirm {fmtUsdc(amountMicro)} payment</Button>
      </div>}
      {sent && <p className="text-[12px] text-ink-3">Keep this page open. It checks Arc and updates your credit automatically.</p>}
    </div>
  );
}
