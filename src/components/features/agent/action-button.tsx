"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { AgentLog } from "@/components/features/agent/agent-log";

type Result = { ok: boolean; error?: string; code?: "INSUFFICIENT_CREDIT"; nextHref?: "/billing" | "/app/team"; message?: string; log?: { agent: string; message: string }[] };

/**
 * Runs a server action, reports the outcome as a toast, refreshes server data, and (optionally)
 * opens the agent's step-by-step log so the founder can see *why* it did what it did.
 */
export function ActionButton({
  action,
  label,
  icon,
  variant = "secondary",
  size = "sm",
  confirm,
  logTitle,
  disabled,
  className,
}: {
  action: () => Promise<Result>;
  label: ReactNode;
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "xs" | "sm" | "md" | "lg";
  confirm?: string;
  logTitle?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [log, setLog] = useState<Result["log"] | null>(null);
  const router = useRouter();
  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={pending}
        disabled={disabled}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            try {
              const r = await action();
              if (!r.ok) toast.error(r.code === "INSUFFICIENT_CREDIT" ? "Scan credit needed" : "Couldn’t complete that", r.error, r.code === "INSUFFICIENT_CREDIT" && r.nextHref ? { label: r.nextHref === "/billing" ? "Add credit in Billing" : "Ask workspace owner", href: r.nextHref } : undefined);
              else if (r.message) toast.success(r.message);
              if (r.ok && logTitle && r.log?.length) setLog(r.log);
              router.refresh();
            } catch {
              toast.error("Couldn’t complete that", "Check your connection and try again.");
            }
          });
        }}
      >
        {label}
      </Button>
      <Dialog open={!!log} onClose={() => setLog(null)} title={logTitle ?? "Agent log"} description="Each line is a step the agents took, in order." size="lg">
        <AgentLog log={log ?? []} />
      </Dialog>
    </>
  );
}
