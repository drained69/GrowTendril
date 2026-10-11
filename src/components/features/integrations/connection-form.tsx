"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { removeIntegrationAction, saveIntegrationAction, testIntegrationAction } from "@/server/actions/integrations";
import type { ActionResult } from "@/server/actions/_common";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";

/** Serializable subset of CredentialField (providers carry functions and can't cross to the client). */
export type FieldSpec = { key: string; label: string; secret: boolean; placeholder?: string; optional?: boolean; help?: string };

export function ConnectionForm({
  providerId,
  providerName,
  fields,
  config,
  connected,
  testable,
  canManage,
}: {
  providerId: string;
  providerName: string;
  fields: FieldSpec[];
  /** Non-secret values already stored for this workspace (secrets are never sent back). */
  config: Record<string, string>;
  /** A workspace credential row exists. */
  connected: boolean;
  /** Something can run right now (workspace, platform default or keyless). */
  testable: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!connected && fields.length > 0 && canManage);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [, start] = useTransition();

  const run = (kind: "save" | "test" | "remove", fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      setBusy(kind);
      const r = await fn();
      setBusy(null);
      if (!r.ok) toast.error(kind === "test" ? `${providerName} test failed` : "Couldn’t complete that", r.error);
      else {
        const warn = r.message?.startsWith("Saved, but");
        (warn ? toast.info : toast.success)(r.message ?? "Done");
        after?.();
      }
      router.refresh();
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) values[f.key] = String(fd.get(f.key) ?? "");
    run("save", () => saveIntegrationAction(providerId, values), () => setEditing(false));
  };

  return (
    <div className="space-y-3">
      {editing && (
        <form onSubmit={onSubmit} className="space-y-3 rounded-[8px] border border-line bg-bg/40 p-3">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`${providerId}-${f.key}`} hint={f.help} required={!f.optional}>
              <Input
                id={`${providerId}-${f.key}`}
                name={f.key}
                type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "new-password" : "off"}
                spellCheck={false}
                // A stored secret is never sent back; leaving its field blank keeps it.
                required={!f.optional && !(f.secret && connected)}
                defaultValue={f.secret ? "" : (config[f.key] ?? "")}
                placeholder={f.secret && connected ? "Leave blank to keep the stored value" : f.placeholder}
                className={f.secret ? "num" : undefined}
              />
            </Field>
          ))}
          <p className="text-[11px] text-ink-4">Secrets are encrypted at rest and never shown again — only a short hint is kept.</p>
          <div className="flex items-center justify-end gap-2">
            {connected && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" variant="primary" size="sm" loading={busy === "save"} icon={<KeyRound />}>
              Save &amp; test
            </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && !editing && fields.length > 0 && (
          <Button size="xs" variant={connected ? "secondary" : "primary"} icon={<KeyRound />} onClick={() => setEditing(true)}>
            {connected ? "Replace credentials" : "Add credentials"}
          </Button>
        )}
        <Button size="xs" variant="secondary" icon={<PlugZap />} loading={busy === "test"} disabled={!testable} title={testable ? undefined : "Add credentials first"} onClick={() => run("test", () => testIntegrationAction(providerId))}>
          Test
        </Button>
        {canManage && connected && (
          <Button
            size="xs"
            variant="ghost"
            className="text-critical hover:text-critical"
            icon={<Trash2 />}
            loading={busy === "remove"}
            onClick={() => {
              if (!window.confirm(`Remove ${providerName} credentials from this workspace? Scans will fall back to the platform default, if any.`)) return;
              run("remove", () => removeIntegrationAction(providerId));
            }}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
