"use client";
import { useEffect, useRef, useState } from "react";
import { CreditCard, X } from "lucide-react";
import type { OnrampWidget } from "@circle-fin/onramp-kit";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** "Add budget" → Arc Onramp widget → USDC to the workspace wallet address. */
export function OnrampButton({ address, userId, disabled }: { address: string; userId: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<OnrampWidget | null>(null);
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "open" | "error">("idle");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setState("idle");
    setMsg("");
    return () => { request.current?.abort(); widget.current?.close(); };
  }, [address, userId]);
  function close() {
    request.current?.abort();
    widget.current?.close();
    widget.current = null;
    setState("idle");
  }
  async function start() {
    if (request.current && !request.current.signal.aborted && (state === "loading" || state === "open")) return;
    setState("loading");
    setMsg("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const { createOnrampKit, fetchOnrampSession } = await import("@circle-fin/onramp-kit");
      if (controller.signal.aborted) return;
      const session = await fetchOnrampSession({ url: "/api/onramp/sessions", body: { appUserId: userId, destinationAddress: address }, signal: controller.signal });
      if (controller.signal.aborted || !ref.current) return;
      widget.current?.close();
      widget.current = createOnrampKit().mountIframe({
        session,
        container: ref.current,
        title: "Add wallet funds with Circle Onramp",
        onDepositSettled: () => {
          const m = "Onramp reported a settled deposit. Refresh the wallet to check your balance.";
          setMsg(m);
          toast.success("Onramp deposit reported", m);
        },
        onInitializationError: () => {
          widget.current?.close();
          setState("error");
          setMsg("Onramp couldn’t load. Close it and try opening a new session.");
        },
        onSessionExpired: () => {
          widget.current?.close();
          setState("error");
          setMsg("This Onramp session expired. Open it again to continue.");
        },
        onDepositNotCompleted: () => setMsg("The deposit was not completed. Check its status in Onramp before starting another deposit."),
      });
      setState("open");
    } catch (e) {
      if (controller.signal.aborted) return;
      setState("error");
      setMsg((e as Error).message);
      toast.error("Couldn’t open Onramp", (e as Error).message);
    }
  }
  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2">
        <Button icon={<CreditCard />} onClick={start} loading={state === "loading"} disabled={disabled || state === "open"}>
          {state === "loading" ? "Opening Onramp…" : state === "open" ? "Onramp open" : "Add budget (Onramp)"}
        </Button>
        {(state === "open" || state === "loading") && <Button variant="ghost" icon={<X />} onClick={close}>Close Onramp</Button>}
      </div>
      {msg && <div role={state === "error" ? "alert" : "status"} className={`mt-1.5 text-[11.5px] ${state === "error" ? "text-critical" : "text-ink-3"}`}>{msg}</div>}
      <div ref={ref} className={state === "open" || state === "loading" ? "mt-3 h-[560px] overflow-hidden rounded-[8px] border border-line" : ""} />
    </div>
  );
}
