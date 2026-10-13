import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CampaignInput, MAX_CAMPAIGN_SLOTS, campaignEconomics, qualityScore, rewardFor } from "@/lib/creator-campaigns";
import { toMicro } from "@/lib/money";
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
    expect(campaignEconomics(CampaignInput.parse({...input,base:"5"})).perCreator).toBe(11e6);
    expect(qualityScore(review as never)).toBe(80);
    expect(rewardFor({baseMicro:4e6,qualityBonusMicro:3e6,outcomeBonusMicro:1e6,outcomeCap:3},80,20)).toBe(9.4e6);
  });
  it("accepts real budgets, exact decimal amounts and bounded creator pools",()=>{
    const terms = CampaignInput.parse({...input,cashLimit:"1000000.000001",maxCpa:"100000",slots:"12",base:"25",qualityBonus:"10",outcomeBonus:"5"});
    expect(terms.cashLimit).toBe(1000000000001);
    expect(campaignEconomics(terms).reserved).toBe(600e6);
    expect(CampaignInput.safeParse({...input,slots:String(MAX_CAMPAIGN_SLOTS+1)}).success).toBe(false);
    expect(CampaignInput.safeParse({...input,base:"9007199254.740992"}).success).toBe(false);
    expect(()=>campaignEconomics(CampaignInput.parse({...input,target:"10000",maxCpa:"1000000000"}))).toThrow(/safe integer/);
    expect(()=>campaignEconomics(CampaignInput.parse({...input,base:"9000000000",qualityBonus:"100000000"}))).toThrow(/safe integer/);
    expect(()=>campaignEconomics(CampaignInput.parse({...input,base:"1000000000",slots:"1000"}))).toThrow(/safe integer/);
  });
  it("checks the maximum promised reward against the workspace ceiling",async()=>{
    await expect(flow.createCreatorCampaign(db,"project","owner",{...input,base:"5"})).rejects.toThrow(/per-payment ceiling of 10 USDC/);
  });
  it("calculates quality rewards exactly when percentage multiplication exceeds safe precision",()=>{
    expect(rewardFor({baseMicro:1,qualityBonusMicro:9007199254740990,outcomeBonusMicro:0,outcomeCap:0},50,0)).toBe(4503599627370496);
  });
  it("accepts the same safe monetary range for campaign terms and reward payment actions",async()=>{
    const {parseFinancialAction} = await import("@/server/domain/agent/actions");
    const action = {action:"send_payment",purpose:"kol_payment",recipient:wallet,currency:"USDC",chain:"Arc",experimentId:"experiment",missionId:"mission",reasonCode:"PAY_CREATOR",expectedValue:"medium",confidence:1};
    for (const amount of ["1000000000.000001","9007199254.740991"]) {
      const terms = CampaignInput.parse({...input,target:"1",slots:"1",cashLimit:amount,maxCpa:amount,base:amount,qualityBonus:"0",outcomeBonus:"0"});
      expect(campaignEconomics(terms).perCreator).toBe(toMicro(amount));
      expect(parseFinancialAction({...action,amount}).success).toBe(true);
    }
    expect(CampaignInput.safeParse({...input,base:"9007199254.740992"}).success).toBe(false);
    expect(parseFinancialAction({...action,amount:"9007199254.740992"}).success).toBe(false);
  });
  it("creates a reserved campaign without replacing the mission",async()=>{
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

describe("owner-configured creator campaign budgets",()=>{
  const projectId = "real-budget-project";
  const terms = {...input,title:"Funded creator campaign",target:"20",maxCpa:"50",cashLimit:"1000",slots:"12",base:"25",qualityBonus:"10",outcomeBonus:"5"};
  let realProgram: string, realContribution: string;
  async function setCeiling(hardCeiling: string) {
    await setup.activateWorkspace(db,{projectId,rules:{dailySpend:"1000",hardCeiling,autonomousLimit:"0"},autopilot:"off"});
  }
  it("reserves a funded pool above the old reward and participant limits",async()=>{
    await db.insert(s.projects).values({id:projectId,ownerId:"owner",name:"Funded product",website:"https://example.test",webhookSecret:"real-budget-test"});
    await setup.startMission(db,{projectId,templateKey:"first_users",goal:100,days:30,budget:"1000"});
    await setCeiling("100");
    await db.insert(s.wallets).values({id:"real-budget-wallet",projectId,provider:"circle_dcw",address:wallet,circleWalletId:"test",blockchain:"ARC",status:"ACTIVE",dataMode:"LIVE"});
    await db.insert(s.kols).values({id:"real-budget-creator",projectId,provider:"bluesky",handle:"funded-creator",dataMode:"LIVE"});
    realProgram = await flow.createCreatorCampaign(db,projectId,"owner",terms);
    const {program,experiment} = await flow.programById(db,projectId,realProgram);
    expect(program.slots).toBe(12);expect(program.baseMicro).toBe(25e6);
    expect(experiment.budgetMicro).toBe(600e6);
    const allocations = await db.select().from(s.missionBudgets).where(eq(s.missionBudgets.missionId,experiment.missionId));
    expect(allocations.reduce((n,a)=>n+a.allocatedMicro,0)).toBe(1000e6);
    expect(allocations.find(a=>a.category==="kol")!.allocatedMicro).toBe(600e6);
    await expect(flow.createCreatorCampaign(db,projectId,"owner",{...terms,slots:"9"})).rejects.toThrow(/insufficient uncommitted/);
    await expect(flow.createCreatorCampaign(db,projectId,"owner",{...terms,slots:"1",base:"76"})).rejects.toThrow(/per-payment ceiling of 100 USDC/);
    expect((await flow.programById(db,projectId,realProgram)).experiment.budgetMicro).toBe(600e6);
  });
  it("keeps published terms and requires approval of the exact reviewed reward above 10 USDC",async()=>{
    const token = await flow.inviteCreator(db,projectId,"owner",realProgram,"real-budget-creator");
    await flow.acceptCreatorInvite(db,"creator",token,wallet,"https://bsky.app/profile/funded-creator/post/proof");
    const participant = (await flow.invitation(db,token))!.participant.id;
    await flow.verifyParticipant(db,projectId,"owner",participant);
    vi.setSystemTime(Date.now()+1000);
    await flow.submitContribution(db,"creator",participant,"https://bsky.app/profile/funded-creator/post/tutorial",new Date());
    const [post] = await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.participantId,participant));
    realContribution = post.id;
    const {experiment} = await flow.programById(db,projectId,realProgram);
    vi.setSystemTime(experiment.endsAt!.getTime()+1000);
    await flow.reviewContribution(db,projectId,"owner",realContribution,review);
    expect((await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.id,realContribution)))[0].rewardMicro).toBe(33e6);
    await setCeiling("20");
    const denied = await flow.proposeCreatorReward(db,projectId,realContribution);
    expect(denied.verdict).toBe("DENY");expect(denied.approvalId).toBeUndefined();
    expect(denied.message).toMatch(/hard ceiling/);
    await setCeiling("100");
    const proposal = await flow.proposeCreatorReward(db,projectId,realContribution);
    expect(proposal.verdict).toBe("APPROVAL_REQUIRED");
    await expect(execute.resolveApproval(db,{approvalId:proposal.approvalId!,userId:"owner",resolution:"approve",modifiedAmount:"20"})).rejects.toThrow(/exactly/);
    await setCeiling("20");
    const approval = await execute.resolveApproval(db,{approvalId:proposal.approvalId!,userId:"owner",resolution:"approve"});
    expect(approval.status).toBe("denied");expect(approval.reason).toMatch(/hard ceiling/);
    const payments = await flow.campaignPayments(db,experiment.id);
    expect(payments.map(p=>p.transaction.state)).toEqual(["DENIED","DENIED"]);
    expect(payments.every(p=>p.transaction.amountMicro===33e6)).toBe(true);
    const {program} = await flow.programById(db,projectId,realProgram);
    expect({base:program.baseMicro,quality:program.qualityBonusMicro,outcome:program.outcomeBonusMicro,cap:program.outcomeCap}).toEqual({base:25e6,quality:10e6,outcome:5e6,cap:3});
    await expect(flow.closeCreatorCampaign(db,projectId,"owner",realProgram)).rejects.toThrow(/Pay every accepted/);
  });
  it("can propose an exact reviewed reward after 100 prior payment attempts",async()=>{
    const {experiment} = await flow.programById(db,projectId,realProgram);
    const previous = await flow.campaignPayments(db,experiment.id);
    expect(previous).toHaveLength(2);
    await db.insert(s.transactions).values(Array.from({length:98},(_,i)=>({
      id:`real-budget-attempt-${i}`,projectId,missionId:experiment.missionId,experimentId:experiment.id,
      decisionId:previous[0].transaction.decisionId,kind:"send",rail:"app_kit_send",budgetCategory:"kol",
      amountMicro:33e6,recipient:wallet,chain:"Arc",state:"FAILED",dataMode:"LIVE" as const,
      idempotencyKey:`real-budget-attempt-${i}`,
    })));
    await setCeiling("100");
    const retry = await flow.proposeCreatorReward(db,projectId,realContribution);
    expect(retry.verdict).toBe("APPROVAL_REQUIRED");expect(retry.approvalId).toBeDefined();
    const [decision] = await db.select().from(s.agentDecisions).where(eq(s.agentDecisions.id,retry.decisionId));
    expect(decision.action).toMatchObject({contributionId:realContribution,amount:"33",installment:101});
    const payments = await flow.campaignPayments(db,experiment.id);
    expect(payments).toHaveLength(101);
    expect(payments.find(p=>p.transaction.decisionId===retry.decisionId)!.transaction.state).toBe("AWAITING_APPROVAL");
    await expect(flow.proposeCreatorReward(db,projectId,realContribution)).rejects.toThrow(/already paid or awaiting/);
  });
});
