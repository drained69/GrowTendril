import { eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { Card, CardBody, CardHeader, PageHeader, StatusBadge, LinkButton } from "@/components/ui";
import { SubmitPostForm } from "@/components/features/campaigns/forms";
import { CampaignTerms } from "@/components/features/campaigns/terms";
import { campaignPayments, qualifiedOutcomes } from "@/server/domain/growth/creator-campaigns";
import { fmtUsdc } from "@/lib/money";
import { appOrigin } from "@/server/lib/origin";
import { CopyButton } from "@/components/ui/copy";
export const dynamic="force-dynamic";
export default async function CreatorPortal() {
  const user=await requireUser(),db=await getDb(),origin=await appOrigin();
  const rows=await db.select({participant:s.creatorParticipants,program:s.creatorPrograms,experiment:s.experiments,creator:s.kols,campaign:s.campaigns,post:s.creatorContributions})
    .from(s.creatorParticipants).innerJoin(s.creatorPrograms,eq(s.creatorPrograms.id,s.creatorParticipants.programId)).innerJoin(s.experiments,eq(s.experiments.id,s.creatorPrograms.experimentId))
    .innerJoin(s.kols,eq(s.kols.id,s.creatorParticipants.kolId)).innerJoin(s.campaigns,eq(s.campaigns.id,s.creatorParticipants.campaignId))
    .leftJoin(s.creatorContributions,eq(s.creatorContributions.participantId,s.creatorParticipants.id)).where(eq(s.creatorParticipants.userId,user.id));
  return <main className="mx-auto max-w-3xl space-y-6 p-5 py-10"><PageHeader title="Your creator campaigns" description={`Welcome, ${user.name}. Your agreed rewards, submitted work and payout progress.`} actions={<LinkButton href="/app">Business workspace</LinkButton>} />
    {!rows.length && <Card><CardBody><p className="text-sm text-ink-3">You haven’t joined a campaign yet. Open the private invitation shared by the business to read its terms and participate.</p></CardBody></Card>}
    {await Promise.all(rows.map(async ({participant:p,program,experiment:e,creator,campaign,post})=>{
      const payments=await campaignPayments(db,e.id),tx=post?payments.filter(x=>x.action.contributionId===post.id).sort((a,b)=>b.transaction.createdAt.getTime()-a.transaction.createdAt.getTime())[0]?.transaction:null;
      const actions=(await qualifiedOutcomes(db,program.id)).filter(o=>o.participant===p.id).length;
      const open=e.endsAt!>new Date()&&["running","proposed","awaiting_approval"].includes(e.status),link=`${origin}/r/${campaign.referralCode}`;
      return <Card key={p.id}><CardHeader title={e.title} description={`@${creator.handle} · ${p.status}`} action={<StatusBadge status={post?.status??p.status} />} /><CardBody className="space-y-5">
        <CampaignTerms program={program} experiment={e} />
        <LinkButton href={`/creator/escrow/${program.id}`}>View testnet escrow prototype</LinkButton>
        {p.status==="accepted"&&<p className="text-sm text-ink-3">The business is reviewing your account ownership proof. Once verified, you can submit your post here.</p>}
        {p.status==="verified"&&<div className="rounded-xl border border-line p-4 space-y-2"><p className="text-sm font-medium">Include your tracked link so customer actions can count</p><div className="flex items-center gap-2"><code className="break-all text-xs">{link}</code><CopyButton value={link} /></div><p className="text-xs text-ink-3">{actions} verified customer actions so far.</p></div>}
        {post?<div className="space-y-3 text-sm"><a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="underline">Your submitted post ↗</a>
          {post.review?<><p>Quality: {post.score}/100 · reward: <strong>{fmtUsdc(post.rewardMicro??0)}</strong> · {post.outcomeIds.length} qualifying actions at final review.</p><p>{String(post.review.note??"")}</p><p className="text-xs text-ink-3">Relevance {String(post.review.relevance)}/5 · Originality {String(post.review.originality)}/5 · Usefulness {String(post.review.usefulness)}/5 · Discussion {String(post.review.discussion)}/5</p></>:<p className="text-ink-3">Submitted. Final review takes place after the campaign ends.</p>}
          {tx?<p>Payment: <StatusBadge status={tx.state} /> {tx.explorerUrl&&<a href={tx.explorerUrl} target="_blank" rel="noopener noreferrer" className="underline">View receipt</a>}</p>:post.status==="accepted"&&<p>Reward approved in review; awaiting the business’s payment request.</p>}
        </div>:p.status==="verified"&&open?<SubmitPostForm participantId={p.id} />:!open&&<p className="text-sm text-ink-3">The submission window has closed.</p>}
      </CardBody></Card>;
    }))}
  </main>;
}
