"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AgentLog } from "@/components/features/agent/agent-log";
import { jobStatusAction, runCycleAction } from "@/server/actions/agent";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/misc";

/** Queues an operator cycle on the job worker and streams its log by polling the job. */
export function RunAgentButton({ disabled, priceUsdc }: { disabled?: boolean; priceUsdc?: number }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [log, setLog] = useState<{ agent: string; message: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const startingRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await jobStatusAction(jobId);
        if (stopped) return;
        if (!r.ok || !r.data) {
          setError(!r.ok ? r.error : "The worker did not return a job status.");
        } else {
          setError(null);
          setStatus(r.data.status);
          setLog(r.data.log);
          if (r.data.status === "done" || r.data.status === "failed") {
            if (r.data.skipped) {
              const message = r.data.skipped === "balance too low" ? "The balance is too low for a scan — top up in Billing." : r.data.skipped;
              setError(message);
              setStatus("skipped");
              toast.error("Scan didn’t run", message);
            } else if (r.data.status === "done") toast.success("Agent cycle complete", `${r.data.log.length} steps — see the log for decisions`);
            else {
              setError(r.data.error ?? "The worker could not complete this cycle.");
              toast.error("Agent cycle failed", r.data.error ?? undefined);
            }
            setJobId(null);
            router.refresh();
            return;
          }
        }
      } catch {
        if (!stopped) setError("Couldn’t read the worker's status. Checking will retry automatically.");
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [jobId, router]);

  const running = !!jobId;
  return (
    <div className="relative">
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        loading={starting}
        title={priceUsdc ? `Run a market scan now — ${priceUsdc} USDC from the balance` : "Run a market scan now"}
        icon={running ? <Loader2 className="animate-spin" /> : <Play />}
        onClick={async () => {
          if (running) return setOpen(true);
          if (startingRef.current) return;
          startingRef.current = true;
          setStarting(true);
          try {
            const r = await runCycleAction();
            if (!r.ok) return toast.error("Couldn’t start the agent", r.error);
            if (!r.data?.jobId) return toast.error("Couldn’t start the agent", "No job was returned. Try again.");
            setError(null);
            setLog([]);
            setStatus("queued");
            setJobId(r.data.jobId);
            setOpen(true);
          } catch {
            toast.error("Couldn’t start the agent", "Check your connection and try again.");
          } finally {
            startingRef.current = false;
            setStarting(false);
          }
        }}
      >
        {running ? (status === "queued" ? "Queued…" : "Running…") : "Run agent"}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Operator cycle${status ? ` · ${status}` : ""}`} description={running ? "You can close this view and reopen it with the running button." : "Review the outcome and each recorded step."} size="lg">
        {error && <Callout tone="danger" className="mb-3">{error}</Callout>}
        {log.length ? <AgentLog log={log} /> : <div role="status" className="rounded-[14px] border border-dashed border-line-strong bg-surface-2 px-3 py-5 text-center text-[12.5px] text-ink-3">{running ? "Waiting for the worker to report progress…" : "No steps were recorded for this cycle."}</div>}
        <Link href="/app/runs" onClick={() => setOpen(false)} className="mt-3 inline-block text-[12px] text-s1 hover:underline">View all agent runs</Link>
      </Dialog>
    </div>
  );
}
