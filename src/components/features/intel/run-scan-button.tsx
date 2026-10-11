import { Radar } from "lucide-react";
import { runScanAction } from "@/server/actions/agent";
import { LinkButton } from "@/components/ui";
import { ActionButton } from "@/components/features/agent/action-button";

/**
 * "Run scan" for empty states and page headers. Queues the discovery-only job (collect + analyze,
 * never buys or pays). Viewers without operate permission get a link to the runs page instead.
 */
export function RunScanButton({ canOperate, label = "Run scan", variant = "primary" }: { canOperate: boolean; label?: string; variant?: "primary" | "secondary" }) {
  if (!canOperate)
    return (
      <LinkButton href="/app/runs" variant={variant} icon={<Radar />}>
        Agent runs
      </LinkButton>
    );
  return <ActionButton action={runScanAction} label={label} variant={variant} icon={<Radar />} />;
}
