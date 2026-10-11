"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { resolveApprovalAction } from "@/server/actions/approvals";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { AgentLog } from "@/components/features/agent/agent-log";

type Log = { agent: string; message: string }[];

/** Approve (optionally at a reduced amount) or reject one spend approval. Server re-checks deny rules. */
export function ApprovalControls({ id, requested, canReduce = true }: { id: string; requested: string; canReduce?: boolean }) {
  const [amount, setAmount] = useState(requested);
  const [modify, setModify] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"approve" | "reject" | null>(null);
  const router = useRouter();

  const reduced = modify && amount.trim() !== "" && amount.trim() !== requested;
  const invalid = modify && (!/^\d{1,7}(\.\d{1,6})?$/.test(amount.trim()) || Number(amount) <= 0 || Number(amount) > Number(requested));

  const go = (resolution: "approve" | "reject") => {
    if (resolution === "reject" && !window.confirm("Reject this spend? The agent will not retry it.")) return;
    setWhich(resolution);
    start(async () => {
      setError(null);
      const r = await resolveApprovalAction(id, resolution, resolution === "approve" && reduced ? amount.trim() : undefined, note.trim() || undefined);
      if (!r.ok) {
        setError(r.error);
        toast.error("Couldn’t resolve approval", r.error);
      } else {
        const out = (r.data ?? {}) as { status?: string; state?: string };
        // Approval is not execution: a denied re-check or a failed payment is reported as such.
        if (out.status === "denied" || out.state === "FAILED") toast.error(r.message ?? "Not executed");
        else toast.success(r.message ?? (resolution === "approve" ? "Approved" : "Rejected"));
        if (r.log?.length) setLog(r.log);
      }
      setWhich(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {modify && (
        <Field label="Approved amount" htmlFor={`amt-${id}`} error={invalid ? `Enter a positive amount up to ${requested} USDC` : null} hint={`Requested ${requested} USDC — you can only reduce it.`}>
          <div className="relative">
            <Input id={`amt-${id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num pr-12" disabled={pending} />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
          </div>
        </Field>
      )}
      <Field label="Note" htmlFor={`note-${id}`} hint="Optional — stored on the decision receipt.">
        <Textarea id={`note-${id}`} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why you approved or rejected" disabled={pending} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Check />} loading={pending && which === "approve"} disabled={pending || invalid} onClick={() => go("approve")}>
          {reduced ? `Approve ${amount.trim()} USDC` : "Approve & execute"}
        </Button>
        <Button variant="danger" icon={<X />} loading={pending && which === "reject"} disabled={pending} onClick={() => go("reject")}>
          Reject
        </Button>
        {canReduce && (
          <Button
            variant="ghost"
            icon={<Pencil />}
            disabled={pending}
            onClick={() => {
              setModify((m) => !m);
              setAmount(requested);
            }}
          >
            {modify ? "Keep requested" : "Reduce amount"}
          </Button>
        )}
      </div>
      {error && <p className="text-[11.5px] text-critical">{error}</p>}
      <Dialog open={!!log} onClose={() => setLog(null)} title="What happened" description="Each line is a step the agents took after your decision." size="lg">
        <AgentLog log={log ?? []} />
      </Dialog>
    </div>
  );
}
