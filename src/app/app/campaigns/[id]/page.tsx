import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import * as s from "@/server/db/schema";
import { programById, campaignParticipants, campaignPayments, qualifiedOutcomes, observedMindshare } from "@/server/domain/growth/creator-campaigns";
import { Card, CardBody, CardHeader, PageHeader, Stat, StatStrip, LinkButton, StatusBadge } from "@/components/ui";
import { InviteCreatorForm, ReviewPostForm } from "@/components/features/campaigns/forms";
import { CampaignTerms } from "@/components/features/campaigns/terms";
import { ActionButton } from "@/components/features/agent/action-button";
import { verifyCreatorAction, proposeCreatorRewardAction, closeCreatorCampaignAction } from "@/server/actions/creator-campaigns";
import { fmtUsdc } from "@/lib/money";
export default async function Campaign({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params, { db, project, role } = await requireProject();
  const found = await db.select({ id:s.creatorPrograms.id }).from(s.creatorPrograms).where(and(eq(s.creatorPrograms.id,id),eq(s.creatorPrograms.projectId,project.id)));
  if (!found.length) notFound();
  const {program:p,experiment:e} = await programById(db,project.id,id);
  const [members, payments, outcomes, share, creators] = await Promise.all([
    campaignParticipants(db,id), campaignPayments(db,e.id), qualifiedOutcomes(db,id), observedMindshare(db,project.id,p,e),
    db.select({id:s.kols.id,handle:s.kols.handle}).from(s.kols).where(and(eq(s.kols.projectId,project.id),eq(s.kols.provider,p.platform),eq(s.kols.dataMode,"LIVE")))
  ]);
  const paid = payments.filter(x=>x.transaction.state==="SETTLED").reduce((n,x)=>n+x.transaction.amountMicro,0);
  const pending = payments.filter(x=>["PROPOSED","AWAITING_APPROVAL","AUTHORIZED","EXECUTING","SUBMITTED","EXCEPTION"].includes(x.transaction.state)).reduce((n,x)=>n+x.transaction.amountMicro,0);
  const active = ["running","awaiting_approval","proposed"].includes(e.status), ended = e.endsAt! <= new Date();
  return <div className="space-y-5">
    <PageHeader title={e.title} description={`${p.topic} · ${p.platform} · ${members.length}/${p.slots} creator slots`} actions={<><LinkButton href="/app/campaigns">All campaigns</LinkButton><LinkButton href="/app/approvals">Payment approvals</LinkButton><LinkButton href={`/app/campaigns/${id}/escrow`}>Testnet escrow</LinkButton></>} />
    <StatStrip className="grid-cols-2 lg:grid-cols-4"><Stat label="Reward pool" value={fmtUsdc(e.budgetMicro)} /><Stat label="Paid · chain confirmed" value={fmtUsdc(paid)} /><Stat label="Pending payment" value={fmtUsdc(pending)} /><Stat label={active?"Still reserved":"Released / unused"} value={fmtUsdc(Math.max(0,e.budgetMicro-paid-pending))} /></StatStrip>
    <StatStrip className="grid-cols-2 lg:grid-cols-4"><Stat label="Verified actions" value={outcomes.length} sub={`target ${e.successTarget}`} /><Stat label="Paid cost per action" value={outcomes.length?fmtUsdc(Math.round(paid/outcomes.length)):"—"} sub="Settled rewards ÷ verified actions" /><Stat label="Target maximum cost" value={fmtUsdc(e.stopMaxCpaMicro)} /><Stat label="Campaign state" value={!active?e.status:ended?"Review open":"Collecting posts"} /></StatStrip>
    <p className="text-xs text-ink-3">Cost per action includes creator payouts only; service credit is billed separately. Signed events establish referral attribution, not causal lift. Connect your product events in <a className="underline" href="/app/integrations">Integrations</a>.</p>
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4"><h2 className="text-lg font-semibold">Contribution ledger</h2>
        {!members.length && <Card><CardBody><p className="text-sm text-ink-3">Invite a creator from {p.platform}. They accept the terms, prove account ownership and submit one original post.</p></CardBody></Card>}
        {members.map(({participant:m,creator:k,campaign:c,contribution:post})=>{
          const txs=post?payments.filter(x=>x.action.contributionId===post.id):[];
          const latest=txs.sort((a,b)=>b.transaction.createdAt.getTime()-a.transaction.createdAt.getTime())[0]?.transaction;
          const count=share.byCreator[k.handle.toLowerCase().replace(/^@/,"")]??0;
          return <Card key={m.id}><CardHeader title={`@${k.handle}`} description={m.status==="accepted"?"Ownership proof awaiting your review":m.status} action={<StatusBadge status={post?.status??m.status} />} /><CardBody className="space-y-4">
            <p className="text-xs text-ink-3">Observed mindshare: {share.eligiblePosts?`${(100*count/share.eligiblePosts).toFixed(1)}% · ${count}/${share.eligiblePosts} eligible posts`:"No observed topic posts yet"} · {outcomes.filter(o=>o.participant===m.id).length} verified actions</p>
            {m.proofUrl && <div className="rounded-xl bg-surface-2 p-3 text-xs space-y-2"><a href={m.proofUrl} target="_blank" rel="noopener noreferrer" className="underline">Open account ownership proof</a><p>Check this code appears on @{k.handle}: <strong className="break-all">{m.challenge}</strong></p><p className="break-all">Payout: {m.payoutAddress}</p>{m.status==="accepted" && can(role,"approve") && active && !ended && <ActionButton action={verifyCreatorAction.bind(null,m.id)} label="I checked the account · verify" />}</div>}
            {m.status==="verified" && <p className="text-xs text-ink-3">Tracked link: <a href={`/r/${c.referralCode}`} className="underline">/r/{c.referralCode}</a></p>}
            {post ? <><a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">View submitted post ↗</a>
              {post.review && <div className="rounded-xl bg-surface-2 p-3 text-sm space-y-2"><p><strong>{post.score}/100 quality</strong> · {post.outcomeIds.length} verified actions at review · {fmtUsdc(post.rewardMicro??0)} reward</p><p>{String(post.review.note??"")}</p><p className="text-xs">Relevance {String(post.review.relevance)}/5 · Originality {String(post.review.originality)}/5 · Usefulness {String(post.review.usefulness)}/5 · Discussion {String(post.review.discussion)}/5</p></div>}
              {post.status==="submitted" && active && (ended ? can(role,"approve") && <ReviewPostForm contributionId={post.id} /> : <p className="text-xs text-ink-3">Final review opens {e.endsAt!.toISOString().replace("T"," ").slice(0,16)} UTC.</p>)}
              {latest && <p className="text-sm">Payment: <StatusBadge status={latest.state} /> {latest.explorerUrl && <a href={latest.explorerUrl} target="_blank" rel="noopener noreferrer" className="underline">Receipt ↗</a>}</p>}
              {active && post.status==="accepted" && can(role,"operate") && (!latest || ["DENIED","FAILED","REJECTED"].includes(latest.state)) && <ActionButton action={proposeCreatorRewardAction.bind(null,post.id)} label={`Request approval · ${fmtUsdc(post.rewardMicro??0)}`} />}
            </> : <p className="text-xs text-ink-3">{m.status==="invited"?"Waiting for creator acceptance":"No post submitted yet"}</p>}
          </CardBody></Card>;
        })}
      </div>
      <div className="space-y-4">
        {can(role,"operate") && active && !ended && <Card><CardHeader title="Invite a creator" description="You share the private link. Nothing is sent automatically." /><CardBody>{creators.length?<InviteCreatorForm programId={id} creators={creators.filter(k=>!members.some(m=>m.creator.id===k.id&&m.participant.userId))} />:<p className="text-sm">No creators from this source yet. <a href="/app/kols" className="underline">Find creators</a>.</p>}</CardBody></Card>}
        <Card><CardHeader title="Published terms" /><CardBody><CampaignTerms program={p} experiment={e} /></CardBody></Card>
        <Card><CardHeader title="Mindshare coverage" /><CardBody><p className="text-sm text-ink-3">{share.observedPosts} observed posts · {share.eligiblePosts} eligible author-days · {share.authors} authors on {p.platform}, during this campaign. Matches the literal topic “{p.topic}”. Duplicate URLs and multiple posts by an author on the same UTC day count once. Coverage depends on connected sources; this is a sample, not platform-wide share. It never determines payment.</p></CardBody></Card>
        <div className="space-y-2"><p className="text-xs text-ink-3">Closing releases unused rewards after all submitted work is reviewed and earned payments settle.</p>{active && can(role,"manage_policy") && <ActionButton action={closeCreatorCampaignAction.bind(null,id)} label="Close campaign & release unused rewards" />}</div>
      </div>
    </div>
  </div>;
}
