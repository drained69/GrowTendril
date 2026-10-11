import { notFound } from "next/navigation";
import { CircleDollarSign, ClipboardCheck, ExternalLink as ExternalIcon, FlaskConical, Inbox, Link2, ListChecks, Lock, ReceiptText, RefreshCw, Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { campaignLedger, getCampaign, observedMindshare, type CampaignLedger, type LedgerLine, type Participant } from "@/server/domain/growth/creator-campaigns";
import { ATTRIBUTION_GRACE_DAYS } from "@/server/domain/growth/creator-campaigns";
import { PLATFORM_LABEL, type CampaignPlan } from "@/server/domain/growth/campaign-plan";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { closeCampaignAction, decideParticipantAction, proposePayoutAction, syncCampaignAction } from "@/server/actions/campaigns";
import { appOrigin, campaignPostsFor, campaignStatus, fmtDate, fmtPct } from "@/server/queries/campaigns";
import { ARC, addressExplorerUrl } from "@/server/integrations/circle/config";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, EmptyState, ExternalLink, KeyValue, LinkButton, ModeBadge, PageHeader, Stat, StatusBadge, TxStateBadge, shortHash, type Tone } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { CopyField } from "@/components/ui/copy";
import { ActionButton } from "@/components/features/agent/action-button";
import { ReviewForm } from "@/components/features/campaigns/review-form";

export const metadata = { title: "Creator campaign" };

const PARTICIPANT_TONE: Record<string, Tone> = { applied: "warn", accepted: "good", declined: "muted", removed: "bad" };
const STATE: Record<LedgerLine["state"], { tone: Tone; label: string }> = {
  earned: { tone: "warn", label: "Earned" },
  in_payout: { tone: "info", label: "In payout" },
  paid: { tone: "good", label: "Paid" },
  simulated: { tone: "accent", label: "Simulated" },
  void: { tone: "muted", label: "Void" },
};
const KIND: Record<string, string> = { post: "Accepted post", discussion: "Discussion bonus", action: "Verified action" };

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role, db } = await requireProject();
  const c = await getCampaign(db, project.id, id);
  if (!c) notFound();
  const operate = can(role, "operate");
  const [ledger, posts, origin] = await Promise.all([campaignLedger(db, c), campaignPostsFor(db, c.id), appOrigin()]);
  const participants = ledger.creators.map((x) => x.participant);
  const mindshare = await observedMindshare(db, c, participants);
  const byId = new Map<string, Participant>(participants.map((p) => [p.id, p]));
  const st = campaignStatus(c);
  const target = EVENT_LABEL[c.targetEvent as ConversionEventType] ?? c.targetEvent;
  const targetLower = target.toLowerCase();
  const joinUrl = `${origin}/c/${c.joinToken}`;
  const plan = (c.plan ?? {}) as Partial<CampaignPlan>;
  const queue = posts.filter((p) => p.status === "submitted").sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const reviewed = posts.filter((p) => p.status !== "submitted");
  const lines = ledger.creators.flatMap((x) => x.lines).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const accepted = participants.filter((p) => p.status === "accepted").length;
  const applied = participants.filter((p) => p.status === "applied").length;
  const handle = (pid: string) => {
    const p = byId.get(pid);
    return p ? `@${p.handle}` : "—";
  };
  const sources = mindshare.providers.map((p) => PLATFORM_LABEL[p] ?? p).join(", ");

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Creator campaigns", href: "/app/campaigns" }]}
        title={
          <>
            <span className="num font-normal text-ink-4">#{c.number}</span> {c.name}
          </>
        }
        description={c.brief.length > 220 ? `${c.brief.slice(0, 220)}…` : c.brief}
        meta={
          <>
            <StatusBadge status={st.key === "ended" ? "pending" : st.key} label={st.label} />
            <ModeBadge mode={c.dataMode} />
            <span>
              {fmtDate(c.startsAt)} – {fmtDate(c.endsAt)}
            </span>
            <span className="text-ink-4">·</span>
            <span>
              Target: <span className="text-ink-2">{target}</span> at ≤ <span className="num text-ink-2">{fmtUsdc(c.maxCostPerActionMicro)}</span>
            </span>
            <span className="text-ink-4">·</span>
            <span>Topic: {c.topic}</span>
          </>
        }
        actions={
          <>
            <LinkButton href={`/app/experiments/${c.experimentId}`} icon={<FlaskConical />} variant="ghost">
              Experiment
            </LinkButton>
            {operate && <ActionButton action={syncCampaignAction.bind(null, c.id)} label="Sync verified actions" icon={<RefreshCw />} />}
            {operate && c.status === "open" && (
              <ActionButton
                action={closeCampaignAction.bind(null, c.id)}
                label="Close campaign"
                icon={<Lock />}
                variant="danger"
                confirm="Close this campaign? Creators can no longer join or submit posts, and unearned reservations are released. Rewards already earned can still be paid."
              />
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <BudgetCard ledger={ledger} open={c.status === "open"} />

        <Card>
          <CardHeader title="Join link" icon={<Link2 />} description={st.key === "open" ? "Share with creators. They see the rules below before they apply." : "The link still works, but it now shows the campaign as closed to new creators."} />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              <CopyField value={joinUrl} className="flex-1" />
              <LinkButton href={joinUrl} external size="sm" variant="ghost" icon={<ExternalIcon />}>
                Open
              </LinkButton>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat size="sm" label="Accepted" value={`${accepted}/${c.maxCreators}`} />
              <Stat size="sm" label="Applications" value={applied} sub="waiting for you" />
              <Stat size="sm" label="Posts to review" value={queue.length} />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Rules creators agreed to" icon={<ListChecks />} description="Shown on the join page before anyone posts. Ceilings are enforced in code when rewards accrue." />
        <div className="grid gap-x-8 gap-y-0 p-4 md:grid-cols-2">
          <KeyValue
            items={[
              { k: "Base pay per accepted post", v: <span className="num">{fmtUsdc(c.basePayMicro)}</span> },
              { k: "Paid posts per creator", v: <span className="num">up to {c.maxPostsPerCreator}</span> },
              { k: "Discussion bonus", v: <span className="num">up to {fmtUsdc(c.discussionBonusCapMicro)} / post</span> },
              { k: `Bonus per verified ${targetLower}`, v: <span className="num">{fmtUsdc(c.actionBonusMicro)}</span> },
            ]}
          />
          <KeyValue
            className="mt-2 md:mt-0"
            items={[
              { k: "Per-creator ceiling", v: <span className="num">{fmtUsdc(c.creatorCapMicro)}</span> },
              { k: "Creators funded", v: <span className="num">{c.maxCreators}</span> },
              { k: "Disclosure required", v: <span className="num">{c.disclosureText}</span> },
              { k: "Destination", v: <ExternalLink href={c.destinationUrl} className="block max-w-[260px] truncate">{c.destinationUrl.replace(/^https:\/\//, "")}</ExternalLink> },
            ]}
          />
        </div>
        {Array.isArray(plan.reasoning) && plan.reasoning.length > 0 && (
          <details className="group border-t border-line px-4 py-3">
            <summary className="cursor-pointer text-[12px] font-medium text-ink-2 hover:text-ink">Why the budget is split this way</summary>
            <ol className="mt-2 space-y-1.5 text-[12px] leading-snug text-ink-2">
              {plan.reasoning.map((r, i) => (
                <li key={r} className="flex gap-2">
                  <span className="num shrink-0 text-ink-4">{i + 1}.</span>
                  <span>{r}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
        <CardFooter>
          Actions count once per unique visitor through a creator’s own tracking link, from launch until {ATTRIBUTION_GRACE_DAYS} days after the window ends. {c.dataMode === "DEMO" ? "Demo campaigns credit demo events." : "Demo events never earn rewards in a live campaign."}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title="Creators" icon={<Users />} description={`${participants.length} application${participants.length === 1 ? "" : "s"} · ${accepted} of ${c.maxCreators} places filled`} />
        <DataTable
          defaultSort={{ key: "status", dir: "asc" }}
          empty={<EmptyState icon={<Users />} title="No creators yet" description="Share the join link. Applications appear here for you to accept or decline; nobody is paid until you accept their posts." />}
          columns={[
            { key: "creator", label: "Creator" },
            { key: "status", label: "Status", sortable: true },
            { key: "posts", label: "Accepted posts", align: "right", sortable: true },
            { key: "actions", label: "Verified actions", align: "right", sortable: true },
            { key: "earned", label: "Earned, unpaid", align: "right", sortable: true },
            { key: "payout", label: "In payout", align: "right", sortable: true },
            { key: "paid", label: "Paid", align: "right", sortable: true },
            { key: "room", label: "Ceiling left", align: "right", sortable: true },
            { key: "mind", label: "Observed mindshare", align: "right", sortable: true },
            { key: "act", label: "" },
          ]}
          rows={ledger.creators.map((x) => {
            const p = x.participant;
            const m = mindshare.byParticipant[p.id];
            return {
              id: p.id,
              cells: {
                creator: (
                  <span className="block max-w-[300px]">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-ink">@{p.handle}</span>
                      <Badge tone="muted">{PLATFORM_LABEL[p.provider] ?? p.provider}</Badge>
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {[p.displayName, p.contact].filter(Boolean).join(" · ") || "No name or contact given"}
                    </span>
                    <span className="num block text-[11px] text-ink-4">
                      pays to{" "}
                      <a href={addressExplorerUrl(ARC.appKitChain, p.payoutAddress)} target="_blank" rel="noreferrer" className="hover:text-ink-2 hover:underline" title={p.payoutAddress}>
                        {shortHash(p.payoutAddress)}
                      </a>
                    </span>
                    {p.pitch && (
                      <span className="mt-0.5 line-clamp-2 block whitespace-normal text-[11.5px] italic text-ink-3" title={p.pitch}>
                        “{p.pitch}”
                      </span>
                    )}
                  </span>
                ),
                status: (
                  <span className="block">
                    <Badge tone={PARTICIPANT_TONE[p.status] ?? "neutral"}>{p.status.replace(/^\w/, (ch) => ch.toUpperCase())}</Badge>
                    <span className="mt-0.5 block text-[11px] text-ink-4">{relTime(p.decidedAt ?? p.createdAt)}</span>
                  </span>
                ),
                posts: (
                  <span className="num">
                    {x.acceptedPosts}
                    <span className="text-ink-4">/{c.maxPostsPerCreator}</span>
                  </span>
                ),
                actions: <span className="num">{x.actions}</span>,
                earned: <span className={x.earnedMicro ? "num text-warning" : "num text-ink-3"}>{fmtUsdc(x.earnedMicro, { unit: false })}</span>,
                payout: <span className="num text-ink-2">{fmtUsdc(x.inPayoutMicro, { unit: false })}</span>,
                paid: (
                  <span className="num block">
                    {fmtUsdc(x.paidMicro, { unit: false })}
                    {x.simulatedMicro > 0 && <span className="block text-[11px] text-ink-4">+{fmtUsdc(x.simulatedMicro, { unit: false })} simulated</span>}
                  </span>
                ),
                room: <span className="num text-ink-2">{p.status === "accepted" ? fmtUsdc(x.remainingCapMicro, { unit: false }) : "—"}</span>,
                mind: m ? (
                  <span className="num block whitespace-nowrap" title={`Observed: ${m.posts} of ${mindshare.observedPosts} on-topic posts collected during the window${sources ? ` (${sources})` : ""}. A sample, not every post.`}>
                    {fmtPct(m.share)} <span className="text-ink-4">posts</span>
                    <span className="block text-[11px] text-ink-3">
                      {fmtPct(m.engagementShare)} engagement · n={m.posts}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-4">—</span>
                ),
                act: operate ? (
                  <span className="flex flex-col items-end gap-1">
                    {p.status === "applied" && (
                      <span className="flex gap-1.5">
                        <ActionButton action={decideParticipantAction.bind(null, c.id, p.id, false)} label="Decline" size="xs" variant="ghost" confirm={`Decline @${p.handle}?`} />
                        <ActionButton action={decideParticipantAction.bind(null, c.id, p.id, true)} label="Accept" size="xs" variant="primary" disabled={accepted >= c.maxCreators} />
                      </span>
                    )}
                    {(p.status === "accepted" || x.lines.length > 0) && (
                      <>
                        <ActionButton
                          action={proposePayoutAction.bind(null, c.id, p.id)}
                          label={x.earnedMicro > 0 ? `Pay ${fmtUsdc(x.earnedMicro)}` : "Nothing to pay"}
                          icon={<CircleDollarSign />}
                          size="xs"
                          variant={x.earnedMicro > 0 ? "secondary" : "ghost"}
                          disabled={x.earnedMicro <= 0}
                          confirm={`Propose paying ${fmtUsdc(x.earnedMicro)} to @${p.handle} at ${p.payoutAddress} on ${ARC.name}? It is checked by your spend policy and, above your limits, waits in the Approval Inbox.`}
                        />
                        <span className="text-[10.5px] text-ink-4">via spend policy & approval</span>
                      </>
                    )}
                  </span>
                ) : null,
              },
              sort: {
                status: ({ applied: 0, accepted: 1, declined: 2, removed: 3 } as Record<string, number>)[p.status] ?? 9,
                posts: x.acceptedPosts,
                actions: x.actions,
                earned: x.earnedMicro,
                payout: x.inPayoutMicro,
                paid: x.paidMicro,
                room: x.remainingCapMicro,
                mind: m?.share ?? 0,
              },
            };
          })}
        />
        <CardFooter>
          <span>
            Observed mindshare: share of the <span className="num text-ink-2">{mindshare.observedPosts}</span> on-topic posts GrowthOS collected during the window{sources ? ` from ${sources}` : ""}, and of their engagement. It is a sample — platforms don’t expose every post.
          </span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title="Review queue" icon={<Inbox />} description="Score each post against the rubric. Accepting requires you to confirm the paid relationship is clearly disclosed." action={queue.length ? <Badge tone="warn">{queue.length} waiting</Badge> : undefined} />
        {queue.length ? (
          <ul className="divide-y divide-line">
            {queue.map((post) => (
              <li key={post.id} className="space-y-3 px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ExternalLink href={post.url} className="block max-w-[640px] truncate text-[12.5px]">
                      {post.url.replace(/^https:\/\//, "")}
                    </ExternalLink>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">
                      {handle(post.participantId)} · {PLATFORM_LABEL[byId.get(post.participantId)?.provider ?? ""] ?? "—"} · submitted {relTime(post.submittedAt)}
                    </div>
                    {post.note && <p className="mt-1 text-[12px] text-ink-2">“{post.note}”</p>}
                  </div>
                  <Disclosure detected={post.disclosureDetected} />
                </div>
                {operate ? <ReviewForm campaignId={c.id} postId={post.id} disclosureText={c.disclosureText} /> : <p className="text-[12px] text-ink-3">Reviewing posts needs the operator role.</p>}
              </li>
            ))}
          </ul>
        ) : (
          <CardBody className="text-[12.5px] text-ink-3">No posts waiting. Accepted creators submit links to their posts from their private contribution page.</CardBody>
        )}
      </Card>

      {reviewed.length > 0 && (
        <Card>
          <CardHeader title="Reviewed posts" icon={<ClipboardCheck />} description="Re-reviewing replaces the earlier outcome, unless its rewards are already being paid." />
          <ul className="divide-y divide-line">
            {reviewed.map((post) => (
              <li key={post.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={post.status === "accepted" ? "approved" : "rejected"} label={post.status === "accepted" ? "Accepted" : "Rejected"} />
                      <ExternalLink href={post.url} className="block max-w-[520px] truncate text-[12.5px]">
                        {post.url.replace(/^https:\/\//, "")}
                      </ExternalLink>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">
                      {handle(post.participantId)} · reviewed {relTime(post.reviewedAt)}
                      {post.review?.note && <span className="text-ink-2"> · “{post.review.note}”</span>}
                    </div>
                  </div>
                  {post.review && (
                    <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                      <span className="text-[13px] text-ink">{post.qualityScore ?? "—"}/100</span>
                      <span>rel {post.review.relevance}</span>
                      <span>depth {post.review.depth}</span>
                      <span>acc {post.review.accuracy}</span>
                      <span>disc. {post.review.discussion}/3</span>
                      <Badge tone={post.review.disclosure ? "good" : "muted"}>{post.review.disclosure ? "Disclosure confirmed" : "Disclosure not confirmed"}</Badge>
                    </div>
                  )}
                </div>
                {operate && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink">Change review</summary>
                    <ReviewForm campaignId={c.id} postId={post.id} initial={post.review} disclosureText={c.disclosureText} className="mt-2" />
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Reward ledger" icon={<ReceiptText />} description="Every amount a creator earned, with its reason and evidence. Creators see their own lines on their contribution page." />
        <DataTable
          searchable
          defaultSort={{ key: "when", dir: "desc" }}
          empty={<div className="text-center text-[12.5px] text-ink-3">No rewards yet. Lines appear when you accept a post, rate its discussion, or a verified {targetLower} arrives through a creator’s tracking link.</div>}
          columns={[
            { key: "when", label: "When", sortable: true },
            { key: "creator", label: "Creator", sortable: true },
            { key: "kind", label: "Kind", sortable: true },
            { key: "amount", label: "Amount", align: "right", sortable: true },
            { key: "state", label: "State", sortable: true },
            { key: "reason", label: "Reason" },
            { key: "evidence", label: "Evidence" },
            { key: "tx", label: "Payment" },
          ]}
          rows={lines.map((l) => ({
            id: l.id,
            cells: {
              when: <span className="whitespace-nowrap text-ink-3">{relTime(l.createdAt)}</span>,
              creator: <span className="whitespace-nowrap">{handle(l.participantId)}</span>,
              kind: <span className="whitespace-nowrap text-ink-2">{KIND[l.kind] ?? l.kind}</span>,
              amount: <span className={l.state === "void" ? "num text-ink-4 line-through" : "num"}>{fmtUsdc(l.amountMicro, { unit: false })}</span>,
              state: (
                <span title={l.state === "void" ? (l.voidReason ?? "Voided") : undefined}>
                  <Badge tone={STATE[l.state].tone}>{STATE[l.state].label}</Badge>
                </span>
              ),
              reason: (
                <span className="block max-w-[380px] whitespace-normal text-[12px] text-ink-2">
                  {l.reason}
                  {l.state === "void" && l.voidReason && <span className="block text-[11px] text-ink-4">Voided: {l.voidReason}</span>}
                </span>
              ),
              evidence: <Evidence line={l} />,
              tx: l.explorerUrl && l.txHash ? (
                <ExternalLink href={l.explorerUrl} className="num whitespace-nowrap text-[11.5px]">
                  {shortHash(l.txHash, 4)}
                </ExternalLink>
              ) : l.txState ? (
                <TxStateBadge state={l.txState} />
              ) : (
                <span className="text-ink-4">—</span>
              ),
            },
            sort: { when: l.createdAt.getTime(), creator: handle(l.participantId), kind: l.kind, amount: l.amountMicro, state: l.state },
            search: `${handle(l.participantId)} ${l.kind} ${l.state} ${l.reason}`,
          }))}
        />
        <CardFooter>Amounts in USDC. A payout that is denied, rejected or fails returns its lines to “earned” so they can be paid again.</CardFooter>
      </Card>

      {c.status === "closed" && (
        <Callout tone="info" title="This campaign is closed">
          Creators can no longer join or submit. Earned rewards can still be paid, and verified actions keep syncing until {ATTRIBUTION_GRACE_DAYS} days after the window.
        </Callout>
      )}
    </div>
  );
}

const SEGMENTS: { key: keyof CampaignLedger; label: string; color: string; help: string }[] = [
  { key: "paidMicro", label: "Paid", color: "var(--color-good)", help: "Paid out on-chain (submitted or settled)." },
  { key: "verifiedMicro", label: "Verified & unpaid", color: "var(--color-s4)", help: "Earned from accepted posts, rated discussion and attributed actions, not yet paid." },
  { key: "simulatedMicro", label: "Simulated", color: "var(--color-s7)", help: "Marked as paid by a simulated payout — no funds moved." },
  { key: "reservedMicro", label: "Reserved", color: "var(--color-s1)", help: "Held for accepted creators up to their ceilings, not yet earned (only while open)." },
  { key: "availableMicro", label: "Available", color: "var(--color-surface-3)", help: "Not committed to anyone." },
];

function BudgetCard({ ledger, open }: { ledger: CampaignLedger; open: boolean }) {
  const total = Math.max(1, ledger.budgetMicro);
  const segs = SEGMENTS.filter((x) => x.key !== "simulatedMicro" || ledger.simulatedMicro > 0).map((x) => ({ ...x, value: ledger[x.key] as number }));
  return (
    <Card>
      <CardHeader title="Budget" icon={<CircleDollarSign />} description={`${fmtUsdc(ledger.budgetMicro)} test budget, reserved from the mission`} />
      <CardBody className="space-y-4">
        <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[3px] bg-surface-3">
          {segs
            .filter((x) => x.value > 0)
            .map((x) => (
              <div key={x.key} className="h-full first:rounded-l-[3px] last:rounded-r-[3px]" style={{ width: `${(x.value / total) * 100}%`, background: x.color }} title={`${x.label}: ${fmtUsdc(x.value)}`} />
            ))}
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {segs.map((x) => (
            <div key={x.key} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3">
                <span className="size-2 rounded-[2px] ring-1 ring-inset ring-line-strong" style={{ background: x.color }} />
                {x.label}
              </dt>
              <dd className="num mt-0.5 text-[17px] font-medium tracking-[-0.02em] text-ink">{fmtUsdc(x.value, { unit: false })}</dd>
              <dd className="text-[11.5px] leading-snug text-ink-3">
                {x.help}
                {x.key === "verifiedMicro" && ledger.inPayoutMicro > 0 && <> {fmtUsdc(ledger.inPayoutMicro)} of it is in a payout awaiting approval or executing.</>}
                {x.key === "reservedMicro" && !open && <> The campaign is closed, so nothing is held.</>}
              </dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

function Disclosure({ detected }: { detected: boolean | null }) {
  const d =
    detected === true
      ? { tone: "good" as Tone, label: "Disclosure detected", why: "GrowthOS observed this post from a connected source and found disclosure text. Still confirm it yourself." }
      : detected === false
        ? { tone: "bad" as Tone, label: "No disclosure detected", why: "GrowthOS observed this post from a connected source and found no disclosure text. Check the post before accepting." }
        : { tone: "muted" as Tone, label: "Disclosure unknown", why: "Only detectable when GrowthOS has observed the post through a connected source. Open the post and check it yourself." };
  return (
    <div className="max-w-[300px] text-right">
      <Badge tone={d.tone}>{d.label}</Badge>
      <p className="mt-1 text-[11px] leading-snug text-ink-4">{d.why}</p>
    </div>
  );
}

function Evidence({ line }: { line: LedgerLine }) {
  const e = line.evidence;
  if (e.url)
    return (
      <ExternalLink href={e.url} className="whitespace-nowrap text-[11.5px]">
        Post
      </ExternalLink>
    );
  if (e.eventId)
    return (
      <span className="num block whitespace-nowrap text-[11px] text-ink-3" title={`Conversion event ${e.eventId}`}>
        {EVENT_LABEL[e.eventType as ConversionEventType] ?? e.eventType} · {shortHash(e.eventId, 4)}
        {e.occurredAt && <span className="block text-ink-4">{relTime(e.occurredAt)}</span>}
      </span>
    );
  return <span className="text-ink-4">—</span>;
}
