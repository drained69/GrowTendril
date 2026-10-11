import type { Metadata } from "next";
import { CalendarDays, Globe, Lock, UserPlus } from "lucide-react";
import { getDb } from "@/server/db/client";
import { ATTRIBUTION_GRACE_DAYS, campaignByJoinToken } from "@/server/domain/growth/creator-campaigns";
import { PLATFORM_LABEL } from "@/server/domain/growth/campaign-plan";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { joinCampaignAction } from "@/server/actions/campaigns";
import { isMainnetEnv } from "@/server/integrations/circle/network-env";
import { appOrigin, fmtDate } from "@/server/queries/campaigns";
import { Badge, Callout, Card, CardBody, CardHeader, ExternalLink, LinkButton } from "@/components/ui";
import { CampaignShell } from "@/components/features/campaigns/public-shell";
import { CampaignRules } from "@/components/features/campaigns/campaign-rules";
import { JoinForm } from "@/components/features/campaigns/join-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join a creator campaign", robots: { index: false, follow: false } };

export default async function JoinCampaign({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const found = token && token.length >= 16 ? await campaignByJoinToken(db, token) : null;

  if (!found) {
    return (
      <CampaignShell title="This campaign link isn’t valid" description="Check that you copied the whole link, or ask the business that shared it for a new one.">
        <LinkButton href="/" variant="secondary">
          Go to GrowthOS
        </LinkButton>
      </CampaignShell>
    );
  }

  const { campaign: c, projectName, website, acceptedCreators, open } = found;
  const target = EVENT_LABEL[c.targetEvent as ConversionEventType] ?? c.targetEvent;
  const network = isMainnetEnv() ? "Arc mainnet" : "Arc Testnet";
  const origin = await appOrigin();
  const ended = Date.now() > c.endsAt.getTime();

  return (
    <CampaignShell
      width="wide"
      eyebrow={
        <>
          <span className="font-medium text-ink-2">{projectName}</span>
          <span className="text-ink-4">·</span>
          <span>Creator campaign</span>
          {open ? <Badge tone="good" dot>Accepting creators</Badge> : <Badge tone="muted">Closed to new creators</Badge>}
          {c.dataMode === "DEMO" && <Badge tone="accent">Demo</Badge>}
        </>
      }
      title={c.name}
      description={
        <>
          {projectName} is funding a small, measurable test about <span className="font-medium text-ink">{c.topic}</span>. Opt in, publish something useful, and earn under the rules below — you see all of them before you post.
        </>
      }
      aside={website ? <ExternalLink href={website}>{website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</ExternalLink> : undefined}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="The brief" />
            <CardBody className="space-y-4">
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{c.brief}</p>
              <div className="grid gap-3 text-[12.5px] sm:grid-cols-3">
                <div>
                  <div className="label mb-1 flex items-center gap-1.5">
                    <Globe className="size-3" /> Platforms
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.platforms.map((p) => (
                      <Badge key={p}>{PLATFORM_LABEL[p] ?? p}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label mb-1 flex items-center gap-1.5">
                    <CalendarDays className="size-3" /> Window
                  </div>
                  <div className="num text-ink">
                    {fmtDate(c.startsAt)} – {fmtDate(c.endsAt)}
                  </div>
                </div>
                <div>
                  <div className="label mb-1">Places</div>
                  <div className="num text-ink">
                    {acceptedCreators} of {c.maxCreators} filled
                  </div>
                </div>
              </div>
              {c.topicTerms.length > 0 && (
                <div className="text-[12px] text-ink-3">
                  Related terms: <span className="text-ink-2">{c.topicTerms.join(", ")}</span>
                </div>
              )}
            </CardBody>
          </Card>

          <CampaignRules c={c} targetLabel={target} graceDays={ATTRIBUTION_GRACE_DAYS} />

          <Card>
            <CardHeader title="Getting paid" />
            <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
              <p>
                Rewards are paid in <span className="font-medium text-ink">USDC on {network}</span> to the 0x address you give below.
                {!isMainnetEnv() && " This deployment runs on a test network, so payouts are test USDC with no cash value."}
              </p>
              <p>In this first version a person at {projectName} reviews every post and every payout. Payouts go through the business’s spend policy and may wait for approval, so they are not instant.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What’s stored about you" icon={<Lock />} />
            <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
              <p>
                Your platform and handle, the display name, contact and pitch you choose to give, your payout address, and the time you accepted these rules. {projectName} sees all of it so they can review your application and pay you; it isn’t shown on this public page.
              </p>
              <p>Also stored: the post links you submit, the reviewer’s scores and notes, your reward lines, and visits and actions that arrive through your tracking link. To measure observed mindshare, GrowthOS counts public posts about this topic that it collects from connected sources.</p>
              <p>Your private contribution link is stored only as a hash — nobody, including GrowthOS, can show it to you again if you lose it.</p>
            </CardBody>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6">
          {open ? (
            <Card>
              <CardHeader title="Apply to join" icon={<UserPlus />} description={`${projectName} reviews applications. Once accepted you get your own tracking link and can submit posts.`} />
              <JoinForm action={joinCampaignAction.bind(null, token)} platforms={c.platforms.map((p) => ({ value: p, label: PLATFORM_LABEL[p] ?? p }))} disclosureText={c.disclosureText} origin={origin} />
            </Card>
          ) : (
            <Callout tone="info" title="This campaign isn’t accepting creators">
              {c.status === "closed" ? `${projectName} has closed this campaign.` : ended ? "The campaign window has ended." : "The campaign window hasn’t started yet."} If you already joined, use your private contribution link to see your posts and rewards.
            </Callout>
          )}
        </div>
      </div>
    </CampaignShell>
  );
}
