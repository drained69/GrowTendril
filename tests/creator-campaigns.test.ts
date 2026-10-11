import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CampaignInput, campaignEconomics, qualityScore, rewardFor } from "@/lib/creator-campaigns";
import type { DB } from "@/server/db/client";
process.env.PGLITE_DIR = "memory://";
vi.mock("@/server/integrations/circle/signer", () => ({ signerFor: () => ({ kind: "test" }) }));
vi.mock("@/server/integrations/circle/appkit", () => ({ appKitSend: async () => { throw new Error("Test transport unavailable"); } }));
let db: DB;
let s: typeof import("@/server/db/schema");
let flow: typeof import("@/server/domain/growth/creator-campaigns");
let setup: typeof import("@/server/domain/workspace/setup");
let execute: typeof import("@/server/domain/agent/execute");
let attr: typeof import("@/server/domain/growth/attribution");
let programId: string, participantId: string, contributionId: string, secondParticipant: string, secondContribution: string;
const wallet = "0x1111111111111111111111111111111111111111";
const input = { title: "Builder campaign", topic: "wallet tools", brief: "Try the SDK and publish a useful original tutorial for builders.", platform: "bluesky", goal: "signup", target: "10", maxCpa: "10", cashLimit: "100", slots: "2", base: "4", qualityBonus: "3", outcomeBonus: "1", outcomeCap: "3" };
const review = { relevance: 4, originality: 4, usefulness: 4, discussion: 4, note: "An original tutorial with concrete code and helpful answers in its discussion.", decision: "accepted" };
beforeAll(async () => {
  const client = await import("@/server/db/client"); db=await client.getDb(); s=client.schema;
  flow=await import("@/server/domain/growth/creator-campaigns"); setup=await import("@/server/domain/workspace/setup"); execute=await import("@/server/domain/agent/execute"); attr=await import("@/server/domain/growth/attribution");
  await db.insert(s.users).values(["owner","creator","creator2","other"].map(id=>({id,email:`${id}@example.test`,name:id,emailVerifiedAt:new Date()})));
  await db.insert(s.projects).values({id:"project",ownerId:"owner",name:"Builder product",website:"https://example.test",webhookSecret:"test"});
  await setup.startMission(db,{projectId:"project",templateKey:"first_users",goal:20,days:30,budget:"200"});
  await setup.activateWorkspace(db,{projectId:"project",rules:{dailySpend:"100",hardCeiling:"10",autonomousLimit:"0"},autopilot:"off"});
  await db.insert(s.wallets).values({id:"wallet",projectId:"project",provider:"circle_dcw",address:wallet,circleWalletId:"test",blockchain:"ARC",status:"ACTIVE",dataMode:"LIVE"});
  await db.insert(s.kols).values(["alpha","beta","gamma"].map(id=>({id,projectId:"project",provider:"bluesky",handle:id,dataMode:"LIVE" as const})));
});
afterAll(()=>vi.useRealTimers());
describe("creator campaign economics",()=>{
  it("reserves only the published creator commitments and caps against economics",()=>{
    expect(campaignEconomics(CampaignInput.parse(input))).toEqual({ceiling:100e6,perCreator:10e6,reserved:20e6,unallocated:80e6});
    expect(()=>campaignEconomics(CampaignInput.parse({...input,cashLimit:"19"}))).toThrow(/exceed/);
    expect(()=>campaignEconomics(CampaignInput.parse({...input,base:"5"}))).toThrow(/10 USDC/);
    expect(qualityScore(review as never)).toBe(80);
    expect(rewardFor({baseMicro:4e6,qualityBonusMicro:3e6,outcomeBonusMicro:1e6,outcomeCap:3},80,20)).toBe(9.4e6);
  });
  it("creates a reserved pilot without replacing the mission",async()=>{
    programId=await flow.createCreatorCampaign(db,"project","owner",input);
    const {experiment}=await flow.programById(db,"project",programId);
    expect(experiment.budgetMicro).toBe(20e6); expect(experiment.channel).toBe("creator_program");
    await expect(flow.programById(db,"wrong-project",programId)).rejects.toThrow(/not found/);
    await expect(setup.startMission(db,{projectId:"project",templateKey:"first_users",goal:20,days:30,budget:"200"})).rejects.toThrow(/Close active/);
  });
  it("moves only unused category allocation and protects aggregate mission reservations",async()=>{
    const id=await flow.createCreatorCampaign(db,"project","owner",{...input,slots:"10"});
    const {experiment}=await flow.programById(db,"project",id);
    const alloc=await db.select().from(s.missionBudgets).where(eq(s.missionBudgets.missionId,experiment.missionId));
    expect(alloc.reduce((n,a)=>n+a.allocatedMicro,0)).toBe(200e6);
    expect(alloc.find(a=>a.category==="kol")!.allocatedMicro).toBe(120e6);
    await expect(flow.createCreatorCampaign(db,"project","owner",{...input,slots:"10"})).rejects.toThrow(/insufficient/);
    await flow.closeCreatorCampaign(db,"project","owner",id);
  });
});
describe("creator participation and evidence",()=>{
  it("rotates unclaimed invites and binds consent to one verified account",async()=>{
    const old=await flow.inviteCreator(db,"project","owner",programId,"alpha");
    const token=await flow.inviteCreator(db,"project","owner",programId,"alpha");
    expect(await flow.invitation(db,old)).toBeNull();
    await flow.acceptCreatorInvite(db,"creator",token,wallet,"https://bsky.app/profile/alpha/post/proof");
    participantId=(await flow.invitation(db,token))!.participant.id;
    await expect(flow.acceptCreatorInvite(db,"other",token,wallet,"https://example.test/proof")).rejects.toThrow(/already/);
    await expect(flow.submitContribution(db,"other",participantId,"https://example.test/post",new Date())).rejects.toThrow(/not found/);
    await expect(flow.submitContribution(db,"creator",participantId,"https://example.test/post",new Date())).rejects.toThrow(/verify/);
    await expect(flow.verifyParticipant(db,"wrong-project","owner",participantId)).rejects.toThrow(/not found/);
    await flow.verifyParticipant(db,"project","owner",participantId);
  });
  it("enforces one account and one post per slot",async()=>{
    const token=await flow.inviteCreator(db,"project","owner",programId,"beta");
    await expect(flow.acceptCreatorInvite(db,"creator",token,wallet,"https://example.test/proof")).rejects.toThrow(/once/);
    await flow.acceptCreatorInvite(db,"creator2",token,wallet,"https://bsky.app/profile/beta/post/proof");
    secondParticipant=(await flow.invitation(db,token))!.participant.id;
    await flow.verifyParticipant(db,"project","owner",secondParticipant);
    await expect(flow.inviteCreator(db,"project","owner",programId,"gamma")).rejects.toThrow(/slots/);
    const t=Date.now()+1000;vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(t);
    await flow.submitContribution(db,"creator",participantId,"https://bsky.app/profile/alpha/post/one",new Date(t));
    await flow.submitContribution(db,"creator2",secondParticipant,"https://bsky.app/profile/beta/post/one",new Date(t));
    await expect(flow.submitContribution(db,"creator",participantId,"https://example.test/another",new Date(t))).rejects.toThrow(/One post/);
    const posts=await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.programId,programId));
    contributionId=posts.find(p=>p.participantId===participantId)!.id;secondContribution=posts.find(p=>p.participantId===secondParticipant)!.id;
    await expect(flow.reviewContribution(db,"project","owner",contributionId,review)).rejects.toThrow(/14-day/);
    await expect(flow.closeCreatorCampaign(db,"project","owner",programId)).rejects.toThrow(/14-day/);
  });
  it("counts signed distinct visitors once across creators, excluding manual and pre-post events",async()=>{
    const members=await flow.campaignParticipants(db,programId);
    const first=members.find(m=>m.participant.id===participantId)!.campaign.referralCode,second=members.find(m=>m.participant.id===secondParticipant)!.campaign.referralCode;
    for (const [key,source,visitor,ref,offset] of [
      ["a","webhook","visitor-1",first,1],["b","webhook","visitor-1",second,2],["c","manual","visitor-2",first,3],
      ["d","webhook",null,first,4],["e","webhook","visitor-3",first,-10000],["f","webhook","visitor-4",first,5]
    ] as const) await attr.recordConversion(db,{projectId:"project",eventType:"signup",source,visitorId:visitor,referralCode:ref,idempotencyKey:key,occurredAt:new Date(Date.now()+offset),dataMode:"LIVE"});
    vi.setSystemTime(Date.now()+1000);
    const outcomes=await flow.qualifiedOutcomes(db,programId);
    expect(outcomes).toHaveLength(2);expect(outcomes.every(o=>o.participant===participantId)).toBe(true);
    const {experiment}=await flow.programById(db,"project",programId);vi.setSystemTime(experiment.endsAt!.getTime()+1000);
    await flow.reviewContribution(db,"project","owner",contributionId,review);
    await flow.reviewContribution(db,"project","owner",secondContribution,{...review,decision:"rejected"});
    const [post]=await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.id,contributionId));
    expect(post.rewardMicro).toBe(8.4e6);expect(post.outcomeIds).toHaveLength(2);
    await expect(flow.reviewContribution(db,"project","owner",contributionId,review)).rejects.toThrow(/already final/);
    await expect(flow.closeCreatorCampaign(db,"project","owner",programId)).rejects.toThrow(/Pay every/);
  });
});
describe("creator reward payment controls",()=>{
  it("blocks generic payments and requires the exact reviewed amount and recipient",async()=>{
    const {experiment}=await flow.programById(db,"project",programId);
    const {launchExperiment}=await import("@/server/domain/growth/experiments");
    await expect(launchExperiment(db,{projectId:"project",experimentId:experiment.id})).rejects.toThrow(/individual posts/);
    const input={action:"send_payment",purpose:"kol_payment",recipient:wallet,amount:"8.4",currency:"USDC",chain:"Arc",experimentId:experiment.id,reasonCode:"PAY_CREATOR",expectedValue:"medium",missionId:experiment.missionId,confidence:1};
    await expect(execute.proposeFinancialAction(db,{projectId:"project",input,rationale:"test",reasons:[],title:"test"})).rejects.toThrow(/reviewed contribution/);
    await expect(execute.proposeFinancialAction(db,{projectId:"project",input:{...input,contributionId,amount:"9"},rationale:"test",reasons:[],title:"test"})).rejects.toThrow(/exactly/);
  });
  it("blocks duplicates, rejects amount editing, and allows a safe retry after rejection",async()=>{
    const r=await flow.proposeCreatorReward(db,"project",contributionId);expect(r.verdict).toBe("APPROVAL_REQUIRED");
    await expect(flow.proposeCreatorReward(db,"project",contributionId)).rejects.toThrow(/already paid/);
    await expect(execute.resolveApproval(db,{approvalId:r.approvalId!,userId:"owner",resolution:"approve",modifiedAmount:"1"})).rejects.toThrow(/exactly/);
    await execute.resolveApproval(db,{approvalId:r.approvalId!,userId:"owner",resolution:"reject"});
    const retry=await flow.proposeCreatorReward(db,"project",contributionId);expect(retry.verdict).toBe("APPROVAL_REQUIRED");
    const result=await execute.resolveApproval(db,{approvalId:retry.approvalId!,userId:"owner",resolution:"approve"});expect(result.state).toBe("FAILED");
    const third=await flow.proposeCreatorReward(db,"project",contributionId);expect(third.verdict).toBe("APPROVAL_REQUIRED");
    await expect(flow.closeCreatorCampaign(db,"project","owner",programId)).rejects.toThrow(/pending/);
  });
});
