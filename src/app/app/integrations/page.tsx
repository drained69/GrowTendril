import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Bell, BookOpen, Code2, Globe, Lock, MessagesSquare, Newspaper, PlaySquare, Plug, Webhook } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { listConnections, type CredentialSource, type ProviderConnection } from "@/server/integrations/vault";
import { CONVERSION_EVENTS, EVENT_LABEL } from "@/server/domain/growth/attribution-links";
import { relTime } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, ExternalLink, KeyValue, PageHeader, Stat, StatStrip, StatusDot, type Tone } from "@/components/ui";
import { CopyButton, CopyField } from "@/components/ui/copy";
import { ConnectionForm } from "@/components/features/integrations/connection-form";
import { WebhookSecret } from "@/components/features/integrations/webhook-secret";
import { AddEndpoint, DeliveryLog, EndpointRow } from "@/components/features/integrations/notifications";
import { DISABLE_AFTER, listEndpoints, MAX_ATTEMPTS, MAX_ENDPOINTS, recentDeliveries, WEBHOOK_EVENTS } from "@/server/domain/notifications/webhooks";

const CATEGORY: Record<string, { label: string; icon: ReactNode }> = {
  social: { label: "Social", icon: <Globe /> },
  code: { label: "Code", icon: <Code2 /> },
  community: { label: "Community", icon: <MessagesSquare /> },
  video: { label: "Video", icon: <PlaySquare /> },
  news: { label: "News & blogs", icon: <Newspaper /> },
};

const ACCESS: Record<string, { label: string; tone: Tone }> = {
  official_api: { label: "Official API", tone: "good" },
  public_api: { label: "Public API", tone: "info" },
  restricted: { label: "Restricted", tone: "muted" },
};

const SOURCE: Record<CredentialSource, { label: string; tone: Tone; help: string }> = {
  workspace: { label: "Workspace key", tone: "good", help: "Using credentials stored for this workspace." },
  platform: { label: "Platform default", tone: "info", help: "Using the deployment's shared credentials. Add your own for separate rate limits." },
  keyless: { label: "Keyless", tone: "info", help: "Public endpoint — no credentials needed." },
  missing: { label: "Missing", tone: "warn", help: "Not connected. This source returns nothing until credentials are added." },
  restricted: { label: "Unavailable", tone: "muted", help: "" },
};

function dotTone(c: ProviderConnection): "good" | "warn" | "bad" | "idle" {
  if (c.source === "restricted") return "idle";
  if (c.status === "error") return "bad";
  return c.ready ? "good" : "warn";
}

export default async function Integrations() {
  const { project, role, db, user } = await requireProject();
  const [connections, endpointRows, deliveryRows] = await Promise.all([listConnections(db, project.id), listEndpoints(db, project.id), recentDeliveries(db, project.id)]);
  // Only display fields reach the browser: the sealed URL and secret stay on the server.
  const endpoints = endpointRows.map((e) => ({ id: e.id, urlHint: e.urlHint, format: e.format, description: e.description, events: e.events, enabled: e.enabled, disabledReason: e.disabledReason, lastStatus: e.lastStatus, lastDeliveryAt: e.lastDeliveryAt?.toISOString() ?? null, secretHint: e.secretHint }));
  const deliveries = deliveryRows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));
  const eventOptions = WEBHOOK_EVENTS.map((e) => ({ ...e }));
  // Guest accounts and DEMO workspaces can't store credentials or feed URLs (enforced in the actions too).
  const sandboxed = user.isGuest || project.dataMode === "DEMO";
  const canManage = can(role, "manage_integrations") && !sandboxed;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const endpoint = `${origin}/api/events`;

  const ready = connections.filter((c) => c.ready).length;
  const own = connections.filter((c) => c.source === "workspace").length;
  const missing = connections.filter((c) => c.source === "missing").length;
  const errors = connections.filter((c) => c.status === "error").length;
  const ordered = [...connections].sort((a, b) => Number(a.source === "restricted") - Number(b.source === "restricted"));

  // "ref" must be a real gt_ref (6–16 lowercase letters/digits) from the visitor's tracked link; this sample has the valid shape.
  const curl = `BODY='{"event":"signup","ref":"k7m2xq9p","visitorId":"user_123","idempotencyKey":"signup-user_123"}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$GROWTENDRIL_WEBHOOK_SECRET" | sed 's/^.* //')

curl -X POST ${endpoint} \\
  -H "content-type: application/json" \\
  -H "x-growtendril-project: ${project.id}" \\
  -H "x-growtendril-signature: t=$T,v1=$SIG" \\
  -d "$BODY"`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrations"
        description="Market data sources the operator scans, and the signed webhook your product uses to report conversions."
        meta={<span>Official and public APIs only, within their terms and rate limits. Unavailable sources return nothing — never invented data.</span>}
      />

      {sandboxed ? (
        <Callout tone="info" title="Demo workspace">Integrations can't be changed here. Create an account and set up your own workspace to connect sources.</Callout>
      ) : (
        !canManage && <Callout tone="info" title="Read-only">Your role can test connections but not change credentials. Owners and admins manage integrations.</Callout>
      )}

      <StatStrip className="grid-cols-2 sm:grid-cols-4">
        <Stat label="Sources ready" value={`${ready} / ${connections.length}`} tone={ready ? "good" : "warn"} />
        <Stat label="Workspace keys" value={own} sub="stored encrypted" />
        <Stat label="Need credentials" value={missing} tone={missing ? "warn" : undefined} />
        <Stat label="Failing checks" value={errors} tone={errors ? "bad" : undefined} />
      </StatStrip>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((c) => {
          const p = c.provider;
          const cat = CATEGORY[p.category] ?? { label: p.category, icon: <Plug /> };
          const access = ACCESS[p.access];
          const src = SOURCE[c.source];
          const restricted = c.source === "restricted";
          return (
            <Card key={p.id} className={restricted ? "opacity-75" : undefined}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <StatusDot tone={dotTone(c)} />
                    {p.name}
                  </span>
                }
                description={p.description}
                icon={cat.icon}
                action={<Badge tone={src.tone}>{src.label}</Badge>}
              />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="muted">{cat.label}</Badge>
                  <Badge tone={access.tone}>
                    {restricted && <Lock className="size-2.5" />}
                    {access.label}
                  </Badge>
                </div>
                {restricted ? (
                  <p className="text-[12px] leading-snug text-ink-3">{p.restrictedReason ?? "Not usable within this provider's terms."}</p>
                ) : (
                  <>
                    <KeyValue
                      items={[
                        { k: "Credentials", v: c.hint ? <span className="num text-ink-2">{c.hint}</span> : <span className="text-ink-3">{c.source === "keyless" ? "None needed" : c.source === "platform" ? "Platform default" : "Not stored"}</span> },
                        {
                          k: "Last checked",
                          v: c.lastCheckedAt ? relTime(c.lastCheckedAt) : <span className="text-ink-3">{c.source === "workspace" ? "Never" : "Not recorded — Test shows the result"}</span>,
                        },
                      ]}
                    />
                    {c.lastError && <Callout tone="danger">{c.lastError}</Callout>}
                    {!c.lastError && c.source !== "workspace" && <p className="text-[11.5px] leading-snug text-ink-3">{src.help}</p>}
                    <ConnectionForm
                      providerId={p.id}
                      providerName={p.name}
                      fields={p.credentialFields.map((f) => ({ key: f.key, label: f.label, secret: f.secret, placeholder: f.placeholder, optional: f.optional, help: f.help }))}
                      config={c.config}
                      connected={c.source === "workspace"}
                      testable={c.ready}
                      canManage={canManage}
                    />
                  </>
                )}
              </CardBody>
              <CardFooter>
                <span className="num text-ink-4">{p.id}</span>
                <ExternalLink href={p.docsUrl} className="text-[11.5px]">
                  Docs
                </ExternalLink>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Card id="notifications">
        <CardHeader
          title="Notifications"
          description="Get told in Slack, Discord or your own system when something needs you — an approval, a payment, a budget threshold, a creator waiting for review."
          icon={<Bell />}
          action={<Badge tone="muted">{endpoints.length} / {MAX_ENDPOINTS}</Badge>}
        />
        {endpoints.length > 0 && (
          <ul className="divide-y divide-line border-b border-line">
            {endpoints.map((ep) => (
              <EndpointRow key={ep.id} ep={ep} events={eventOptions} canManage={canManage} />
            ))}
          </ul>
        )}
        {canManage && endpoints.length < MAX_ENDPOINTS && (
          <CardBody>
            <AddEndpoint events={eventOptions} />
          </CardBody>
        )}
        {!canManage && endpoints.length === 0 && <CardBody><p className="text-[12px] text-ink-3">{sandboxed ? "Notifications are available in your own workspace." : "No notification endpoints yet. Owners and admins can add one."}</p></CardBody>}
        <div className="border-t border-line">
          <div className="px-4 pt-3 pb-1 label">Recent deliveries</div>
          <DeliveryLog deliveries={deliveries} endpoints={endpoints} canManage={canManage} />
        </div>
        <CardFooter>
          <p className="text-[11.5px] leading-relaxed">
            JSON endpoints receive <code className="num">{"{ id, type, created_at, network, workspace, summary, url, data }"}</code> with headers <code className="num">x-growtendril-event</code>, <code className="num">x-growtendril-event-id</code> (stable — use it to de-duplicate) and <code className="num">x-growtendril-signature</code> (same HMAC scheme as inbound events). Non-2xx responses are retried {MAX_ATTEMPTS - 1} times over about 3 hours; an endpoint that fails {DISABLE_AFTER} deliveries in a row, or answers 410, is switched off.
          </p>
        </CardFooter>
      </Card>

      <Card id="events">
        <CardHeader
          title="Inbound events"
          description="Report conversions (signups, SDK keys, demo requests…) with the visitor's gt_ref so they are attributed to the experiment that produced them."
          icon={<Webhook />}
        />
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:divide-x lg:divide-line">
          <CardBody className="space-y-4">
            <div>
              <div className="label mb-1.5">Endpoint</div>
              <CopyField value={endpoint} />
              <p className="mt-1.5 text-[11.5px] text-ink-3">
                <span className="num">POST</span> · JSON body · max 20 KB · about 120 req/min per IP (bursts up to 120)
              </p>
            </div>
            <div>
              <div className="label mb-1.5">Project ID</div>
              <CopyField value={project.id} />
              <p className="mt-1.5 text-[11.5px] text-ink-3">
                Sent as <code className="num text-ink-2">x-growtendril-project</code>.
              </p>
            </div>
            <div>
              <div className="label mb-1.5">Signing secret</div>
              <WebhookSecret canManage={canManage} />
            </div>
          </CardBody>
          <CardBody className="space-y-4 border-t border-line lg:border-t-0">
            <div>
              <div className="label mb-1.5">Headers</div>
              <KeyValue
                items={[
                  { k: <code className="num">x-growtendril-project</code>, v: <span className="text-ink-2">your project ID</span> },
                  { k: <code className="num">x-growtendril-signature</code>, v: <code className="num text-ink-2">t=&lt;unix&gt;,v1=&lt;hex&gt;</code> },
                ]}
              />
              <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
                <code className="num">v1 = hex(HMAC_SHA256(secret, &quot;&lt;t&gt;.&lt;raw body&gt;&quot;))</code>. Timestamps older than 5 minutes are rejected; <code className="num">idempotencyKey</code> (8–200 chars) makes retries safe.
              </p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label">Example</span>
                <CopyButton value={curl} label="Copy" />
              </div>
              <pre className="num overflow-x-auto rounded-[8px] border border-line bg-bg p-3 text-[11.5px] leading-relaxed text-ink-2">{curl}</pre>
            </div>
            <div>
              <div className="label mb-1.5">Event types</div>
              <div className="flex flex-wrap gap-1">
                {CONVERSION_EVENTS.map((e) => (
                  <span key={e} title={EVENT_LABEL[e]}>
                    <Badge tone="muted" className="num">
                      {e}
                    </Badge>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
                <code className="num">ref</code> is the visitor&apos;s <code className="num">gt_ref</code> (6–16 lowercase letters/digits) — replace the sample value. Optional fields: <code className="num">customName</code>, <code className="num">visitorId</code>, <code className="num">occurredAt</code> (ISO 8601), <code className="num">value</code> (USDC), <code className="num">metadata</code>.
              </p>
            </div>
          </CardBody>
        </div>
        <CardFooter>
          <span className="flex items-center gap-1.5">
            <BookOpen className="size-3.5" />
            Visits are recorded automatically by tracked links <code className="num text-ink-2">/r/&lt;referral code&gt;</code>, which redirect to the UTM-tagged destination.
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
