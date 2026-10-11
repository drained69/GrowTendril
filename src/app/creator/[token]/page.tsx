import type { Metadata } from "next";
import { BarChart3, CircleDollarSign, FileText, Link2, Send } from "lucide-react";
import { getDb } from "@/server/db/client";
import { ATTRIBUTION_GRACE_DAYS, campaignByJoinToken, campaignLedger, observedMindshare, participantByToken, type LedgerLine } from "@/server/domain/growth/creator-campaigns";
import { PLATFORM_LABEL } from "@/server/domain/growth/campaign-plan";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { submitPostAction } from "@/server/actions/campaigns";
import { isMainnetEnv } from "@/server/integrations/circle/network-env";
import { appOrigin, campaignIsOpen, fmtDate, fmtPct, participantPosts, trackingReferralCode } from "@/server/queries/campaigns";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, ExternalLink, LinkButton, Stat, StatStrip, shortHash, type Tone } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { CampaignShell } from "@/components/features/campaigns/public-shell";
import { CampaignRules } from "@/components/features/campaigns/campaign-rules";
import { SubmitPostForm } from "@/components/features/campaigns/submit-post-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your contribution", robots: { index: false, follow: false }, referrer: "no-referrer" };

const STATUS: Record<string, { tone: Tone; label: string; body: string }> = {
  applied: { tone: "warn", label: "Waiting for review", body: "The business hasn’t decided on your application yet. Once accepted, your tracking link and the post form appear here." },
  accepted: { tone: "good", label: "Accepted", body: "You’re in. Publish, then submit each post’s link below. Share your tracking link so verified actions count toward your bonus." },
  declined: { tone: "muted", label: "Not accepted", body: "The business didn’t accept this application, so posts can’t be submitted for this campaign." },
  removed: { tone: "bad", label: "Removed", body: "The business removed you from this campaign, so nothing further can be submitted or earned." },
};
const STATE: Record<LedgerLine["state"], { tone: Tone; label: string }> = {
  holding: { tone: "neutral", label: "Verified — payable after the holdback period" },
  earned: { tone: "warn", label: "Earned — not yet paid" },
  in_payout: { tone: "info", label: "In payout" },
  paid: { tone: "good", label: "Paid" },
  simulated: { tone: "accent", label: "Simulated — no funds moved" },
  void: { tone: "muted", label: "Void" },
};
const KIND: Record<string, string> = { post: "Accepted post", discussion: "Discussion bonus", action: "Verified action" };

export default async function CreatorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const found = await participantByToken(db, token);
  if (!found) {
    return (
      <CampaignShell title="This contribution link isn’t valid" description="Check that you opened the full link you saved when you joined. Links can’t be recovered — if you’ve lost yours, contact the business that runs the campaign.">
        <LinkButton href="/" variant="secondary">
          Go to GrowTendril
        </LinkButton>
      </CampaignShell>
    );
  }
  const { participant: p, campaign: c } = found;
  const [info, ledger, posts, code, mindshare, origin] = await Promise.all([
    campaignByJoinToken(db, c.joinToken),
    campaignLedger(db, c),
    participantPosts(db, p.id),
    p.status === "accepted" ? trackingReferralCode(db, p.trackingCampaignId) : Promise.resolve(null),
    observedMindshare(db, c, [p]),
    appOrigin(),
  ]);
  // Only this creator's own ledger is read from here on — never other creators'.
  const mine = ledger.creators.find((x) => x.participant.id === p.id);
  const lines = mine?.lines ?? [];
  const projectName = info?.projectName ?? "The business";
  const target = EVENT_LABEL[c.targetEvent as ConversionEventType] ?? c.targetEvent;
  const status = STATUS[p.status] ?? { tone: "neutral" as Tone, label: p.status, body: "" };
  const open = campaignIsOpen(c);
  const platform = PLATFORM_LABEL[p.provider] ?? p.provider;
  const ms = mindshare.byParticipant[p.id];
  const sources = mindshare.providers.map((x) => PLATFORM_LABEL[x] ?? x).join(", ");
  const network = isMainnetEnv() ? "Arc mainnet" : "Arc Testnet";

  return (
    <CampaignShell
      width="wide"
      eyebrow={
        <>
          <span className="font-medium text-ink-2">{projectName}</span>
          <span className="text-ink-4">·</span>
          <span>{c.name}</span>
          <span className="text-ink-4">·</span>
          <span className="num">
            {fmtDate(c.startsAt)} – {fmtDate(c.endsAt)}
          </span>
          {!open && <Badge tone="muted">Closed for submissions</Badge>}
          {c.dataMode === "DEMO" && <Badge tone="accent">Demo</Badge>}
        </>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          @{p.handle}
          <Badge tone="muted">{platform}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      }
      description={status.body}
      aside={<span>Private page — don’t share this link</span>}
    >
      <div className="space-y-4">
        <StatStrip className="grid-cols-2 lg:grid-cols-5">
          <Stat label="Earned, not yet paid" value={fmtUsdc(mine?.earnedMicro ?? 0, { unit: false })} sub="USDC" tone={(mine?.earnedMicro ?? 0) > 0 ? "warn" : undefined} />
          <Stat label="In payout" value={fmtUsdc(mine?.inPayoutMicro ?? 0, { unit: false })} sub="awaiting approval or sending" />
          <Stat label="Paid" value={fmtUsdc(mine?.paidMicro ?? 0, { unit: false })} sub={(mine?.simulatedMicro ?? 0) > 0 ? `+${fmtUsdc(mine!.simulatedMicro, { unit: false })} simulated` : `USDC on ${network}`} tone="good" />
          <Stat label="Ceiling left" value={p.status === "accepted" ? fmtUsdc(mine?.remainingCapMicro ?? 0, { unit: false }) : "—"} sub={`of ${fmtUsdc(c.creatorCapMicro, { unit: false })} max`} />
          <Stat label="Accepted posts" value={`${mine?.acceptedPosts ?? 0}/${c.maxPostsPerCreator}`} sub={`${mine?.actions ?? 0} verified ${target.toLowerCase()}${mine?.actions === 1 ? "" : "s"}`} />
        </StatStrip>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            {p.status === "accepted" && (
              <Card>
                <CardHeader title="Your tracking link" icon={<Link2 />} description={`Share this link in your posts. Each unique person who arrives through it and completes a ${target.toLowerCase()} earns your action bonus.`} />
                <CardBody>
                  {code ? (
                    <CopyField value={`${origin}/r/${code}`} />
                  ) : (
                    <p className="text-[12.5px] text-ink-3">Your tracking link isn’t available yet. Ask the business to re-accept your application.</p>
                  )}
                </CardBody>
              </Card>
            )}

            {p.status === "accepted" && (
              <Card>
                <CardHeader title="Submit a post" icon={<Send />} description={`Up to ${c.maxPostsPerCreator} accepted post${c.maxPostsPerCreator === 1 ? " is" : "s are"} paid. The business reviews each one against the rubric.`} />
                <CardBody>
                  {open ? (
                    <SubmitPostForm action={submitPostAction.bind(null, token)} platformLabel={platform} disclosureText={c.disclosureText} />
                  ) : (
                    <p className="text-[12.5px] text-ink-3">This campaign is closed for submissions. Posts you already submitted can still be reviewed, and earned rewards can still be paid.</p>
                  )}
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader title="Your posts" icon={<FileText />} description="Scores are relevance, depth and accuracy (0–5 each), shown as a quality score out of 100." />
              {posts.length ? (
                <ul className="divide-y divide-line">
                  {posts.map((post) => (
                    <li key={post.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <ExternalLink href={post.url} className="block max-w-[520px] truncate text-[12.5px]">
                            {post.url.replace(/^https:\/\//, "")}
                          </ExternalLink>
                          <div className="mt-0.5 text-[11.5px] text-ink-3">
                            Submitted {relTime(post.submittedAt)}
                            {post.reviewedAt && <> · reviewed {relTime(post.reviewedAt)}</>}
                          </div>
                        </div>
                        <Badge tone={post.status === "accepted" ? "good" : post.status === "rejected" ? "bad" : "warn"}>{post.status === "submitted" ? "Waiting for review" : post.status === "accepted" ? "Accepted" : "Not accepted"}</Badge>
                      </div>
                      {post.review ? (
                        <div className="mt-2 space-y-1.5">
                          <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                            <span className="text-[13px] text-ink">{post.qualityScore ?? "—"}/100</span>
                            <span>relevance {post.review.relevance}/5</span>
                            <span>depth {post.review.depth}/5</span>
                            <span>accuracy {post.review.accuracy}/5</span>
                            <span>discussion {post.review.discussion}/3</span>
                            <Badge tone={post.review.disclosure ? "good" : "bad"}>{post.review.disclosure ? "Disclosure confirmed" : "Disclosure not confirmed"}</Badge>
                          </div>
                          {post.review.note && <p className="text-[12px] text-ink-2">Reviewer: “{post.review.note}”</p>}
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[11.5px] text-ink-3">
                          {post.disclosureDetected === true
                            ? "Automatic check: disclosure found in the copy of this post GrowTendril observed. The reviewer still confirms it."
                            : post.disclosureDetected === false
                              ? "Automatic check: GrowTendril observed this post and found no disclosure. Add one if it’s missing — a post without a clear disclosure can’t be accepted."
                              : "Automatic check not available: GrowTendril hasn’t observed this post through a connected source, so the reviewer checks the disclosure by hand."}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-[12.5px] text-ink-3">{p.status === "accepted" ? "No posts yet. Publish your first post, then submit its link above." : "Posts can be submitted once you’re accepted."}</CardBody>
              )}
            </Card>

            <Card>
              <CardHeader title="Your rewards" icon={<CircleDollarSign />} description="Every amount you earned, why, and the evidence behind it." />
              {lines.length ? (
                <ul className="divide-y divide-line">
                  {lines.map((l) => (
                    <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                          <span className="font-medium text-ink">{KIND[l.kind] ?? l.kind}</span>
                          <Badge tone={STATE[l.state].tone}>{STATE[l.state].label}</Badge>
                          <span className="text-[11px] text-ink-4">{relTime(l.createdAt)}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{l.reason}</p>
                        {l.state === "void" && l.voidReason && <p className="text-[11.5px] text-ink-4">Voided: {l.voidReason}</p>}
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
                          {l.evidence.url && <ExternalLink href={l.evidence.url}>Post</ExternalLink>}
                          {l.evidence.eventId && (
                            <span className="num">
                              {EVENT_LABEL[l.evidence.eventType as ConversionEventType] ?? l.evidence.eventType} · event {shortHash(l.evidence.eventId, 4)}
                              {l.evidence.occurredAt && ` · ${relTime(l.evidence.occurredAt)}`}
                            </span>
                          )}
                          {l.explorerUrl && l.txHash && <ExternalLink href={l.explorerUrl} className="num">tx {shortHash(l.txHash, 4)}</ExternalLink>}
                        </div>
                      </div>
                      <span className={l.state === "void" ? "num text-[13px] text-ink-4 line-through" : "num text-[13px] text-ink"}>{fmtUsdc(l.amountMicro)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-[12.5px] text-ink-3">No rewards yet. They appear when a post is accepted, its discussion is rated, or a verified {target.toLowerCase()} arrives through your tracking link.</CardBody>
              )}
              <CardFooter>
                <span>
                  Paid in USDC on {network} to <span className="num text-ink-2" title={p.payoutAddress}>{p.payoutAddress}</span>
                </span>
              </CardFooter>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Observed mindshare" icon={<BarChart3 />} description={`Your share of “${c.topic}” posts GrowTendril observed during the campaign window.`} />
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <Stat size="sm" label="Share of posts" value={fmtPct(ms?.share ?? 0)} sub={`${ms?.posts ?? 0} of ${mindshare.observedPosts}`} />
                  <Stat size="sm" label="Share of engagement" value={fmtPct(ms?.engagementShare ?? 0)} sub="comments, shares, likes" />
                </div>
                <p className="text-[11.5px] leading-snug text-ink-3">
                  Observed, not complete: counted from {mindshare.observedPosts} on-topic post{mindshare.observedPosts === 1 ? "" : "s"} collected from {sources || "connected public sources"}. Platforms don’t expose every post, so this is a sample. It’s shown for context and isn’t what you’re paid on.
                </p>
              </CardBody>
            </Card>

            <CampaignRules c={c} targetLabel={target} graceDays={ATTRIBUTION_GRACE_DAYS} ceilingMicro={p.ceilingMicro ?? undefined} />

            <Callout tone="info" title="About this page">
              This page is your login — there’s no account. Anyone with the link can see it and submit posts as you, so keep it private.
            </Callout>
          </div>
        </div>
      </div>
    </CampaignShell>
  );
}
