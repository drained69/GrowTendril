import { keccak256, toHex } from "viem";
import { canonical } from "@arc-growth/evidence";
import { calculateReward } from "@arc-growth/outcomes";
import testnetDeployment from "../../../../contracts/deployments/arc-testnet.json";
import type { DB } from "@/server/db/client";
import { programById, campaignParticipants, qualifiedOutcomes } from "@/server/domain/growth/creator-campaigns";
export async function escrowPreview(db:DB,projectId:string,programId:string) {
  const {program,experiment}=await programById(db,projectId,programId);
  const [members,outcomes]=await Promise.all([campaignParticipants(db,programId),qualifiedOutcomes(db,programId)]);
  const terms={campaignId:keccak256(toHex(`growtendril:testnet:${projectId}:${programId}`)),termsHash:keccak256(toHex(canonical({brief:program.brief,base:program.baseMicro,qualityBonus:program.qualityBonusMicro,outcomeBonus:program.outcomeBonusMicro,outcomeCap:program.outcomeCap,slots:program.slots,deadline:experiment.endsAt?.toISOString()}))),budgetMicro:experiment.budgetMicro,deadline:Math.floor(experiment.endsAt!.getTime()/1000),baseMicro:program.baseMicro,qualityBonusMicro:program.qualityBonusMicro,outcomeBonusMicro:program.outcomeBonusMicro,outcomeCap:program.outcomeCap,slots:program.slots};
  const rewards=members.filter(m=>m.contribution?.status==="accepted"&&m.participant.status==="verified"&&m.participant.payoutAddress).map(m=>{
    const post=m.contribution!, events=outcomes.filter(o=>o.participant===m.participant.id), count=Math.min(events.length,program.outcomeCap), reward=calculateReward(program,post.score??0,count);
    return {id:post.id,recipient:m.participant.payoutAddress!,score:post.score??0,outcomes:count,amountMicro:reward.totalMicro,evidenceHash:keccak256(toHex(canonical({postId:post.id,score:post.score,outcomeIds:events.map(e=>e.event.id),dataMode:"TESTNET_PROTOTYPE"})))};
  });
  const configured=process.env.NEXT_PUBLIC_ARC_REWARDS_ESCROW_TESTNET || testnetDeployment.address;
  return {terms,rewards,contract:configured&&/^0x[\da-f]{40}$/i.test(configured)?configured:null,title:experiment.title};
}
