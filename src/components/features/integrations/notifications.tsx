"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, Power, RotateCw, Send, Trash2 } from "lucide-react";
import { createEndpointAction, deleteEndpointAction, redeliverAction, rotateEndpointSecretAction, setEndpointEnabledAction, testEndpointAction, updateEndpointEventsAction } from "@/server/actions/notifications";
import type { ActionResult } from "@/server/actions/_common";
import { Badge, Button, Callout, Checkbox, Field, Input, Select } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { toast } from "@/components/ui/toast";

export interface EventOption {
  key: string;
  label: string;
  description: string;
  defaultOn: boolean;
}

export interface EndpointView {
  id: string;
  urlHint: string;
  format: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  lastStatus: string | null;
  lastDeliveryAt: string | null;
  secretHint: string;
}

export interface DeliveryView {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

const FORMAT_LABEL: Record<string, string> = { slack: "Slack", discord: "Discord", json: "JSON (signed)" };
const PLACEHOLDER: Record<string, string> = { slack: "https://hooks.slack.com/services/…", discord: "https://discord.com/api/webhooks/…", json: "https://your-server.com/growtendril-events" };

function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <Callout tone="warn" title="Copy the signing secret now — it won't be shown again" action={<Button size="xs" variant="ghost" onClick={onDone}>Done</Button>}>
      <CopyField value={secret} className="mt-2" />
      <p className="mt-2 text-[11.5px]">Verify each request&apos;s <code className="num">x-growtendril-signature</code> with it. Slack and Discord ignore the signature, so you can skip this for them.</p>
    </Callout>
  );
}

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok: string, then?: (r: ActionResult<T>) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? ok);
      else toast.error("Couldn’t do that", r.error);
      then?.(r);
      router.refresh();
    });
  return { pending, run };
}

export function AddEndpoint({ events, disabled }: { events: EventOption[]; disabled?: boolean }) {
  const [state, action, pending] = useActionState(createEndpointAction, null);
  const [format, setFormat] = useState("slack");
  const [secret, setSecret] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Endpoint added");
      if (state.data?.secret) setSecret(state.data.secret);
      router.refresh();
    } else toast.error("Couldn’t add the endpoint", state.error);
  }, [state, router]);

  return (
    <div className="space-y-3">
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
      <form action={action} className="space-y-3">
        <fieldset disabled={disabled} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <Field label="Send to" htmlFor="wh-format">
              <Select id="wh-format" name="format" value={format} onChange={(e) => setFormat(e.target.value)}>
                {Object.entries(FORMAT_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Webhook URL" htmlFor="wh-url" hint={format === "slack" ? "Slack → Apps → Incoming Webhooks → Add to a channel." : format === "discord" ? "Discord channel → Edit → Integrations → Webhooks → Copy URL." : "Your HTTPS endpoint. Each request is signed like inbound events."}>
              <Input id="wh-url" name="url" type="url" required maxLength={500} placeholder={PLACEHOLDER[format]} autoComplete="off" />
            </Field>
          </div>
          <Field label="Label" htmlFor="wh-desc" hint="Optional, for your team (e.g. #growth channel).">
            <Input id="wh-desc" name="description" maxLength={120} placeholder="Optional" />
          </Field>
          <div>
            <div className="label mb-1.5">Events</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {events.map((e) => (
                <Checkbox
                  key={e.key}
                  name="events"
                  value={e.key}
                  defaultChecked={e.defaultOn}
                  className="items-start rounded-[6px] border border-line px-2.5 py-2 text-[12px] [&>input]:mt-0.5"
                  label={
                    <span>
                      <span className="font-medium text-ink">{e.label}</span>
                      <span className="block text-[11.5px] text-ink-3">{e.description}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" icon={<BellPlus />} loading={pending}>
              Add endpoint
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

export function EndpointRow({ ep, events, canManage }: { ep: EndpointView; events: EventOption[]; canManage: boolean }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>(ep.events);
  const [secret, setSecret] = useState<string | null>(null);
  const label = (k: string) => events.find((e) => e.key === k)?.label ?? k;
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={ep.enabled ? "size-2 rounded-full bg-good" : "size-2 rounded-full bg-ink-4"} />
        <span className="num text-[12.5px] text-ink">{ep.urlHint}</span>
        <Badge tone="muted">{FORMAT_LABEL[ep.format] ?? ep.format}</Badge>
        {ep.description && <span className="text-[12px] text-ink-3">{ep.description}</span>}
        {!ep.enabled && <Badge tone="warn">off</Badge>}
      </div>
      {!ep.enabled && ep.disabledReason && <p className="text-[11.5px] text-warning">{ep.disabledReason}</p>}
      {editing ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {events.map((e) => (
            <Checkbox key={e.key} label={e.label} checked={picked.includes(e.key)} onChange={(x) => setPicked((p) => (x.target.checked ? [...p, e.key] : p.filter((k) => k !== e.key)))} />
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <Button size="xs" variant="primary" loading={pending} onClick={() => run(() => updateEndpointEventsAction(ep.id, picked), "Events saved", (r) => r.ok && setEditing(false))}>
              Save events
            </Button>
            <Button size="xs" variant="ghost" onClick={() => (setPicked(ep.events), setEditing(false))}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {ep.events.map((k) => (
            <Badge key={k} tone="neutral">
              {label(k)}
            </Badge>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-4">
        Secret {ep.secretHint} · {ep.lastDeliveryAt ? `last delivery ${new Date(ep.lastDeliveryAt).toLocaleString()} — ${ep.lastStatus ?? ""}` : "no deliveries yet"}
      </p>
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
      {canManage && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" icon={<Send />} loading={pending} disabled={!ep.enabled} onClick={() => run(() => testEndpointAction(ep.id), "Test delivered")}>
            Send test
          </Button>
          {!editing && (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Edit events
            </Button>
          )}
          <Button size="xs" variant="ghost" icon={<Power />} onClick={() => run(() => setEndpointEnabledAction(ep.id, !ep.enabled), ep.enabled ? "Endpoint off" : "Endpoint on")}>
            {ep.enabled ? "Turn off" : "Turn on"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<RotateCw />}
            onClick={() => {
              if (!window.confirm("Rotate this endpoint's signing secret? Requests signed with the old secret will stop verifying.")) return;
              run(() => rotateEndpointSecretAction(ep.id), "Secret rotated", (r) => r.ok && r.data && setSecret(r.data.secret));
            }}
          >
            Rotate secret
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<Trash2 />}
            onClick={() => {
              if (!window.confirm("Remove this endpoint? Its delivery history is removed too.")) return;
              run(() => deleteEndpointAction(ep.id), "Endpoint removed");
            }}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

export function DeliveryLog({ deliveries, endpoints, canManage }: { deliveries: DeliveryView[]; endpoints: EndpointView[]; canManage: boolean }) {
  const { pending, run } = useRun();
  if (!deliveries.length) return <p className="px-4 py-3.5 text-[12px] text-ink-3">No notifications sent yet.</p>;
  const hint = (id: string) => endpoints.find((e) => e.id === id)?.urlHint ?? "removed endpoint";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-line text-left text-ink-3">
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-2 py-2 font-medium">Event</th>
            <th className="px-2 py-2 font-medium">Endpoint</th>
            <th className="px-2 py-2 font-medium">Result</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td className="whitespace-nowrap px-4 py-2 text-ink-3">{new Date(d.createdAt).toLocaleString()}</td>
              <td className="num px-2 py-2 text-ink-2">{d.event}</td>
              <td className="num px-2 py-2 text-ink-3">{hint(d.endpointId)}</td>
              <td className="px-2 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : "info"}>{d.status === "pending" && d.attempts > 0 ? `retrying (${d.attempts})` : d.status}</Badge>
                  {d.responseStatus != null && <span className="num text-ink-3">HTTP {d.responseStatus}</span>}
                  {d.durationMs != null && <span className="num text-ink-4">{d.durationMs} ms</span>}
                </span>
                {d.error && d.status !== "delivered" && <span className="mt-0.5 block max-w-[420px] truncate text-[11px] text-ink-4" title={d.error}>{d.error}</span>}
              </td>
              <td className="px-4 py-2 text-right">
                {canManage && d.status === "failed" && d.event !== "webhook.test" && (
                  <Button size="xs" variant="ghost" loading={pending} onClick={() => run(() => redeliverAction(d.id), "Queued")}>
                    Resend
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
