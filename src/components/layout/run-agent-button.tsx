"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AgentLog } from "@/components/features/agent/agent-log";
import { jobStatusAction, runCycleAction } from "@/server/actions/agent";

const CONFIRM = "Run the full operator cycle? It scans sources, then may buy data and propose or make USDC payments within your spend policy and approval thresholds.";

/**
 * Queues a full operator cycle (may spend within policy) on the job worker and streams its log by
 * polling the job. Discovery-only scans are started from the pages' "Run scan" buttons.
 */
export function RunAgentButton({ disabled }: { disabled?: boolean }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"done" | "skipped" | "failed" | null>(null);
  const [log, setLog] = useState<{ agent: string; message: string }[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      const r = await jobStatusAction(jobId);
      if (!r.ok) return;
      setStatus(r.data!.status);
      setLog(r.data!.log);
      if (r.data!.status === "done" || r.data!.status === "failed") {
        if (timer.current) clearInterval(timer.current);
        // A job that finished without an agent run attached was skipped by the worker
        // (another cycle or scan held the project), so nothing ran and nothing was spent.
        const skipped = r.data!.status === "done" && (!!r.data!.skipped || r.data!.log.length === 0);
        if (r.data!.status === "failed") toast.error("Agent cycle failed", r.data!.error ?? undefined);
        else if (skipped) toast.info("Cycle skipped", "Another run was already in progress for this workspace — nothing new ran.");
        else toast.success("Agent cycle complete", `${r.data!.log.length} steps — see the log for decisions`);
        setOutcome(r.data!.status === "failed" ? "failed" : skipped ? "skipped" : "done");
        setJobId(null);
        router.refresh();
      }
    };
    poll();
    timer.current = setInterval(poll, 1500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [jobId, router]);

  const running = !!jobId;
  return (
    <div className="relative">
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        loading={running}
        icon={<Play />}
        title="Runs the full loop: may buy data and propose payments within your policy"
        onClick={async () => {
          if (running) return setOpen(true);
          if (!window.confirm(CONFIRM)) return;
          const r = await runCycleAction();
          if (!r.ok) return toast.error("Couldn’t start the agent", r.error);
          if (r.message) toast.info(r.message);
          setLog([]);
          setOutcome(null);
          setStatus("queued");
          setJobId(r.data!.jobId);
          setOpen(true);
        }}
      >
        {running ? (status === "queued" ? "Queued…" : "Running…") : "Run cycle"}
      </Button>
      {open && (log.length > 0 || running) && (
        <div className="absolute right-0 top-9 z-40 w-[min(620px,92vw)] animate-pop-in rounded-[12px] border border-line-strong bg-surface p-3 shadow-[var(--shadow-pop)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Bot className="size-4 text-ink-3" /> Operator cycle{" "}
              {running ? (
                <span className="text-ink-3">· {status}</span>
              ) : outcome === "failed" ? (
                <span className="text-critical">· failed</span>
              ) : outcome === "skipped" ? (
                <span className="text-ink-3">· skipped</span>
              ) : (
                <span className="text-good">· done</span>
              )}
            </span>
            <button aria-label="Close" onClick={() => setOpen(false)} className="text-ink-4 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          {log.length ? <AgentLog log={log} /> : <div className="rounded-[8px] border border-line bg-bg px-3 py-4 text-center text-[12px] text-ink-3">Waiting for the worker to pick up the job…</div>}
        </div>
      )}
    </div>
  );
}
