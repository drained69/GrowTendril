"use client";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";
import { checkInvoiceAction, payWithTxAction } from "@/server/actions/billing";
import { Button, Callout, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";
import { transferCalldata } from "@/lib/erc20";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}


export function PayInvoice(p: { invoiceId: string; payTo: string; amountMicro: number; usdc: string; chainId: number; rpcUrl: string; explorer: string; next: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"waiting" | "sending" | "confirming" | "paid">("waiting");
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [state, action, pending] = useActionState(payWithTxAction.bind(null, p.invoiceId), null);
  const done = useRef(false);
  const mounted = useRef(true);
  const sending = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (done.current || !mounted.current) return;
    done.current = true;
    setStatus("paid");
    toast.success("Payment confirmed on Arc", "The credit is on your balance.");
    redirectTimer.current = setTimeout(() => router.push(p.next), 1200);
  }, [router, p.next]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  // Watch Arc for the transfer every few seconds while the page is open.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || done.current) return;
      try {
        const r = await checkInvoiceAction(p.invoiceId);
        if (stopped || done.current) return;
        if (r.ok && r.data?.paid) return finish();
        if (r.ok && r.data?.status === "expired") {
          setExpired(true);
          setWatchError("This invoice expired. If you already sent USDC, check its transaction hash below; otherwise create a new invoice from Billing.");
          return;
        }
        setWatchError(r.ok ? null : r.error);
        if (sentHash) {
          const fd = new FormData();
          fd.set("txHash", sentHash);
          const payment = await payWithTxAction(p.invoiceId, null, fd);
          if (!stopped && payment.ok) return finish();
        }
      } catch {
        if (!stopped) setWatchError("Couldn’t check Arc right now. Checking will retry automatically; you can also verify your transaction below.");
      }
      if (!stopped && !done.current) timer = setTimeout(tick, sentHash ? 12000 : 6000);
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [p.invoiceId, sentHash, finish]);

  useEffect(() => {
    if (state?.ok) finish();
  }, [state, finish]);

  const payWithWallet = async () => {
    if (sending.current || sentHash || expired || done.current) return;
    const eth = window.ethereum;
    if (!eth) {
      toast.error("No browser wallet found", "Install a wallet such as MetaMask or Rabby, or send the USDC from any wallet using the details above.");
      return;
    }
    let transactionRequested = false;
    try {
      sending.current = true;
      setStatus("sending");
      const [from] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!/^0x[0-9a-fA-F]{40}$/.test(from ?? "")) throw new Error("The wallet did not provide an account. Reconnect it and try again.");
      const chainHex = `0x${p.chainId.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: chainHex, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [p.rpcUrl], blockExplorerUrls: [p.explorer] }],
        });
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      }
      const activeChain = await eth.request({ method: "eth_chainId" });
      if (typeof activeChain !== "string" || Number.parseInt(activeChain, 16) !== p.chainId) throw new Error("Switch your wallet to Arc before sending this payment.");
      if (!mounted.current || done.current) return;
      transactionRequested = true;
      const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: p.usdc, data: transferCalldata(p.payTo, p.amountMicro), value: "0x0" }] })) as string;
      if (!mounted.current || done.current) return;
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        setStatus("confirming");
        toast.info("Check your wallet activity", "The wallet returned an unexpected reference. Automatic payment checking will continue; verify the transaction before sending again.");
        return;
      }
      setSentHash(hash);
      setStatus("confirming");
    } catch (e) {
      if (!mounted.current || done.current) return;
      const msg = (e as { message?: string }).message ?? String(e);
      const cancelled = (e as { code?: number }).code === 4001 || /reject|denied|cancel/i.test(msg);
      if (transactionRequested && !cancelled) {
        setStatus("confirming");
        toast.info("Payment status is unclear", "Check your wallet activity and verify its transaction hash below before sending again. Automatic checking will continue.");
      } else {
        setStatus("waiting");
        if (!cancelled) toast.error("The wallet couldn’t prepare the payment", msg.slice(0, 200));
      }
    } finally {
      sending.current = false;
    }
  };

  if (status === "paid") {
    return (
      <Callout tone="success" title="Payment confirmed">
        Credit added to your balance. Taking you to {p.next === "/billing" ? "billing" : "your workspace"}…
      </Callout>
    );
  }

  return (
    <div className="space-y-5">
      <Button variant="primary" size="lg" className="w-full" icon={status === "sending" || status === "confirming" ? <Loader2 className="animate-spin" /> : <Wallet />} disabled={expired || status !== "waiting"} onClick={payWithWallet}>
        {expired ? "Invoice expired" : status === "sending" ? "Confirm in your wallet…" : status === "confirming" ? "Payment sent — checking Arc…" : "Pay with browser wallet"}
      </Button>
      {sentHash && (
        <p className="text-center text-[12px] text-ink-3">
          Sent:{" "}
          <a href={`${p.explorer}/tx/${sentHash}`} target="_blank" rel="noreferrer" className="num underline">
            {sentHash.slice(0, 10)}…{sentHash.slice(-6)}
          </a>
        </p>
      )}
      {watchError && <Callout tone="warn">{watchError}</Callout>}
      {!expired && <div role="status" className="flex items-center gap-2 rounded-[8px] border border-line bg-bg/40 px-3 py-2.5 text-[12.5px] text-ink-2">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-4" />
        Watching Arc for your payment — this page updates by itself.
      </div>}
      <form action={action} onSubmit={keepValues(action)} className="space-y-2.5">
        <Field label="Already sent it from another wallet?" htmlFor="pay-tx" hint="Paste the transaction hash and we'll check it on Arc right away.">
          <Input key={sentHash ?? "manual"} id="pay-tx" name="txHash" defaultValue={sentHash ?? ""} required pattern="0x[0-9a-fA-F]{64}" minLength={66} maxLength={66} placeholder="0x…" spellCheck={false} autoComplete="off" className="num text-[12px]" />
        </Field>
        {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
        <Button type="submit" variant="secondary" loading={pending} icon={<CheckCircle2 />} className="w-full">
          Check transaction
        </Button>
      </form>
    </div>
  );
}
