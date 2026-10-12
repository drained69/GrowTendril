"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNotificationEndpointAction, deleteNotificationEndpointAction, setNotificationEndpointAction, testNotificationEndpointAction } from "@/server/actions/notifications";
import { Badge, Button, Callout, Checkbox, Field, Input, Select } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { toast } from "@/components/ui/toast";

type Endpoint = { id: string; urlHint: string; format: string; events: string[]; enabled: boolean; lastStatus: string | null };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string };
type Event = { key: string; label: string };

export function Notifications({ endpoints, deliveries, events, canManage }: { endpoints: Endpoint[]; deliveries: Delivery[]; events: Event[]; canManage: boolean }) {
  const [state, action, adding] = useActionState(createNotificationEndpointAction, null);
  const [secret, setSecret] = useState<string | null>(null);
  const [format, setFormat] = useState("slack");
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.data?.secret) setSecret(state.data.secret);
      toast.success(state.message ?? "Endpoint added");
      router.refresh();
    } else toast.error("Could not add endpoint", state.error);
  }, [state, router]);
  const run = (call: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const result = await call();
    if (result.ok) toast.success(result.message ?? "Saved");
    else toast.error("Could not update endpoint", result.error);
    router.refresh();
  });

  return <div className="space-y-4">
    {canManage && <div className="space-y-3">
      {secret && <Callout tone="warn" title="Copy this signing secret now — it is shown once"><CopyField value={secret} className="mt-2" /><Button size="xs" variant="ghost" onClick={() => setSecret(null)}>Done</Button></Callout>}
      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Destination" htmlFor="notification-format"><Select id="notification-format" name="format" value={format} onChange={(event) => setFormat(event.target.value)}><option value="slack">Slack</option><option value="discord">Discord</option><option value="json">Signed JSON</option></Select></Field>
          <Field label="HTTPS webhook URL" htmlFor="notification-url"><Input id="notification-url" name="url" type="url" required maxLength={500} placeholder={format === "slack" ? "https://hooks.slack.com/services/…" : format === "discord" ? "https://discord.com/api/webhooks/…" : "https://your-site.com/events"} /></Field>
        </div>
        <div><p className="label mb-2">Events to send</p><div className="grid gap-2 sm:grid-cols-2">{events.map((event) => <Checkbox key={event.key} name="events" value={event.key} defaultChecked label={event.label} />)}</div></div>
        <Button type="submit" variant="primary" size="sm" loading={adding}>Add endpoint</Button>
      </form>
    </div>}
    <div className="divide-y divide-line rounded-[8px] border border-line">
      {endpoints.length ? endpoints.map((endpoint) => <div key={endpoint.id} className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="num text-[12px]">{endpoint.urlHint}</span><Badge tone={endpoint.enabled ? "good" : "muted"}>{endpoint.enabled ? "On" : "Off"}</Badge><Badge tone="neutral">{endpoint.format}</Badge></div>
        <p className="text-[11.5px] text-ink-3">{endpoint.events.map((key) => events.find((event) => event.key === key)?.label ?? key).join(" · ")}</p>
        {endpoint.lastStatus && <p className="text-[11.5px] text-ink-3">Last result: {endpoint.lastStatus}</p>}
        {canManage && <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" disabled={!endpoint.enabled || pending} onClick={() => run(() => testNotificationEndpointAction(endpoint.id))}>Send test</Button>
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setNotificationEndpointAction(endpoint.id, !endpoint.enabled))}>{endpoint.enabled ? "Turn off" : "Turn on"}</Button>
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => { if (window.confirm("Remove this endpoint and its delivery history?")) run(() => deleteNotificationEndpointAction(endpoint.id)); }}>Remove</Button>
        </div>}
      </div>) : <p className="p-3 text-[12px] text-ink-3">No outbound notification endpoints yet.</p>}
    </div>
    <div><p className="label mb-2">Recent deliveries</p><div className="divide-y divide-line rounded-[8px] border border-line">{deliveries.length ? deliveries.map((delivery) => <div key={delivery.id} className="flex flex-wrap items-center gap-2 p-3 text-[11.5px]"><span className="text-ink-3">{new Date(delivery.createdAt).toLocaleString()}</span><span className="num">{delivery.event}</span><Badge tone={delivery.status === "delivered" ? "good" : delivery.status === "failed" ? "bad" : "info"}>{delivery.status}</Badge><span className="text-ink-3">{delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : delivery.error ?? ""}{delivery.attempts ? ` · ${delivery.attempts} attempt(s)` : ""}</span></div>) : <p className="p-3 text-[12px] text-ink-3">No deliveries yet.</p>}</div></div>
  </div>;
}
