"use client";
import { useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** "Add budget" → Arc Onramp widget → USDC on Arc to the workspace wallet address. */
export function OnrampButton({ address, userId, disabled }: { address: string; userId: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "open" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function start() {
    setState("loading");
    setMsg("");
    try {
      const { createOnrampKit, fetchOnrampSession } = await import("@circle-fin/onramp-kit");
      // The server rebuilds this request (its own wallet, Arc, USDC); these values only pre-fill the widget.
      const session = await fetchOnrampSession({ url: "/api/onramp/sessions", body: { appUserId: userId, destinationAddress: address, destinationChain: "Arc", assets: { pairs: [{ token: "USDC", chain: "arc" }] } } });
      createOnrampKit().mountIframe({
        session,
        container: ref.current!,
        onDepositSettled: ({ payload }: { payload: { amount: string; tokenSymbol: string } }) => {
          const m = `Settled: ${payload.amount} ${payload.tokenSymbol}`;
          setMsg(m);
          toast.success("Onramp deposit settled", m);
        },
      } as never);
      setState("open");
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
      toast.error("Couldn’t open Onramp", (e as Error).message);
    }
  }
  return (
    <div className="w-full">
      <Button icon={<CreditCard />} onClick={start} loading={state === "loading"} disabled={disabled || state === "open"}>
        {state === "loading" ? "Opening Onramp…" : state === "open" ? "Onramp open" : "Add budget (Onramp)"}
      </Button>
      {msg && <div className={`mt-1.5 text-[11.5px] ${state === "error" ? "text-critical" : "text-ink-3"}`}>{msg}</div>}
      <div ref={ref} className={state === "open" ? "mt-3 h-[560px] overflow-hidden rounded-[8px] border border-line" : ""} />
    </div>
  );
}
