import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { invitation } from "@/server/domain/growth/creator-campaigns";
import { Card, CardBody, PageHeader, LinkButton } from "@/components/ui";
import { CampaignTerms } from "@/components/features/campaigns/terms";
import { AcceptCreatorForm } from "@/components/features/campaigns/forms";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function CreatorInvitation({ params }: { params: Promise<{token:string}> }) {
  const {token}=await params, [user,inv]=await Promise.all([currentUser(),getDb().then(db=>invitation(db,token))]);
  if (!inv) notFound();
  const next=encodeURIComponent(`/creator/invite/${token}`), expired=inv.experiment.endsAt!<=new Date()||!["running","proposed","awaiting_approval"].includes(inv.experiment.status);
  return <main className="mx-auto max-w-2xl space-y-5 p-5 py-12">
    <PageHeader title={inv.experiment.title} description={`An invitation for @${inv.creator.handle} on ${inv.program.platform}`} />
    <Card><CardBody><CampaignTerms program={inv.program} experiment={inv.experiment} /></CardBody></Card>
    <Card><CardBody>{expired?<p>This campaign is no longer accepting new creators. <a href="/creator" className="underline">View your contributions</a>.</p>:inv.participant.userId?<p>This invitation has been accepted. <a href="/creator" className="underline">Open creator portal</a>.</p>:!user?<div className="flex flex-wrap gap-3"><LinkButton href={`/signup?next=${next}`} variant="primary">Create a creator account</LinkButton><LinkButton href={`/login?next=${next}`}>Sign in</LinkButton></div>:!user.emailVerified?<LinkButton href={`/verify?next=${next}`}>Verify email to join</LinkButton>:<AcceptCreatorForm token={token} challenge={inv.participant.challenge} />}</CardBody></Card>
    <p className="text-xs text-ink-3">You are joining this campaign as a creator. You do not need to create a business workspace.</p>
  </main>;
}
