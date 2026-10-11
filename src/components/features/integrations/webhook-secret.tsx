"use client";
import { useState, useTransition } from "react";
import { RotateCw } from "lucide-react";
import { rotateWebhookSecretAction } from "@/server/actions/workspace";
import { Button, Callout } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { toast } from "@/components/ui/toast";

/**
 * The stored signing secret is never sent to the browser. Rotating generates a new one, which
 * is shown exactly once here; the old secret stops working immediately.
 */
export function WebhookSecret({ canManage }: { canManage: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {secret ? (
        <Callout tone="warn" title="Copy this secret now — it won't be shown again">
          <CopyField value={secret} className="mt-2" />
          <p className="mt-2 text-[11.5px]">Store it in your product's server environment (e.g. GROWTENDRIL_WEBHOOK_SECRET). The previous secret no longer verifies.</p>
        </Callout>
      ) : (
        <div className="flex items-center gap-2 rounded-[6px] border border-line-strong bg-bg py-1.5 pl-2.5 pr-2">
          <code className="num flex-1 text-[12px] tracking-widest text-ink-4">••••••••••••••••••••••••</code>
          <span className="text-[11px] text-ink-4">stored · hidden</span>
        </div>
      )}
      {canManage ? (
        <Button
          size="sm"
          variant={secret ? "ghost" : "secondary"}
          icon={<RotateCw />}
          loading={pending}
          onClick={() => {
            if (!window.confirm("Rotate the signing secret? Events signed with the current secret will be rejected until your sender is updated.")) return;
            start(async () => {
              const r = await rotateWebhookSecretAction();
              if (!r.ok) toast.error("Couldn’t rotate secret", r.error);
              else if (r.data) {
                setSecret(r.data.secret);
                toast.success(r.message ?? "Secret rotated");
              }
            });
          }}
        >
          {secret ? "Rotate again" : "Rotate & reveal new secret"}
        </Button>
      ) : (
        <p className="text-[11.5px] text-ink-3">Only owners and admins can rotate the signing secret.</p>
      )}
    </div>
  );
}
