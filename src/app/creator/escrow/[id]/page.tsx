import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/current";
import { getDb, schema as s } from "@/server/db/client";
import { escrowPreview } from "@/server/domain/growth/escrow-preview";
import { EscrowControls } from "@/components/features/campaigns/escrow-controls";
import { Card, CardBody, PageHeader, LinkButton, Callout } from "@/components/ui";
export default async function CreatorEscrow({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,user=await requireUser(),db=await getDb();
  const [member]=await db.select({participant:s.creatorParticipants,program:s.creatorPrograms}).from(s.creatorParticipants).innerJoin(s.creatorPrograms,eq(s.creatorPrograms.id,s.creatorParticipants.programId)).where(and(eq(s.creatorParticipants.programId,id),eq(s.creatorParticipants.userId,user.id)));
  if(!member)notFound();
  const preview=await escrowPreview(db,member.program.projectId,id);
  const owned=await db.select({id:s.creatorContributions.id}).from(s.creatorContributions).where(eq(s.creatorContributions.participantId,member.participant.id));
  return <main className="mx-auto max-w-3xl space-y-4 p-5 py-10"><PageHeader title="Creator escrow" description={preview.title} actions={<LinkButton href="/creator">Creator portal</LinkButton>} /><Callout title="Testnet prototype">Claims here use test USDC. Your mainnet creator reward stays in the business approval flow.</Callout><Card><CardBody><EscrowControls {...preview} rewards={preview.rewards.filter(r=>owned.some(o=>o.id===r.id))} canManage={false} /></CardBody></Card></main>;
}
