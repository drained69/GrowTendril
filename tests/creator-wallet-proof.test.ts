import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { DB } from "@/server/db/client";
process.env.PGLITE_DIR = "memory://";
process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY = "test-client-key";
process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL = "https://example.test/arc";
process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CHAIN_ID = "5042";

let db: DB;
let s: typeof import("@/server/db/schema");
let wallet: typeof import("@/server/domain/growth/creator-wallet");
const address = "0x1111111111111111111111111111111111111111";
const token = "a".repeat(64);
beforeAll(async () => {
  const client = await import("@/server/db/client"); db = await client.getDb(); s = client.schema;
  wallet = await import("@/server/domain/growth/creator-wallet");
  await db.insert(s.users).values([{ id:"proof-user",email:"proof@example.test",name:"Proof" },{ id:"other-user",email:"other@example.test",name:"Other" }]);
  await db.insert(s.projects).values({ id:"proof-project",ownerId:"proof-user",name:"Proof workspace",webhookSecret:"secret" });
  await db.insert(s.missions).values({ id:"proof-mission",projectId:"proof-project",template:"custom",name:"Proof mission",goalDescription:"test",goalEvent:"signup",goalTarget:1,budgetMicro:1,startsAt:new Date(),endsAt:new Date(Date.now()+86_400_000) });
  await db.insert(s.experiments).values({ id:"proof-experiment",projectId:"proof-project",missionId:"proof-mission",number:1,title:"Proof",hypothesis:"x",channel:"content",budgetCategory:"kol",target:"t",action:"a",budgetMicro:1,successEvent:"signup",successTarget:1,stopMaxCpaMicro:1,stopAfterSpendMicro:1,timeframeDays:1,dataMode:"LIVE" });
  await db.insert(s.kols).values({ id:"proof-kol",projectId:"proof-project",provider:"bluesky",handle:"proof",dataMode:"LIVE" });
  await db.insert(s.campaigns).values({ id:"proof-campaign",experimentId:"proof-experiment",kolId:"proof-kol",name:"Proof",channel:"bluesky",utmSource:"x",utmMedium:"m",utmCampaign:"c",referralCode:"proofcode",destinationUrl:"https://example.test" });
  await db.insert(s.creatorPrograms).values({ id:"proof-program",projectId:"proof-project",experimentId:"proof-experiment",topic:"t",platform:"bluesky",brief:"b",slots:1,cashLimitMicro:1,baseMicro:1,qualityBonusMicro:0,outcomeBonusMicro:0,outcomeCap:0 });
  await db.insert(s.creatorParticipants).values({ id:"proof-participant",programId:"proof-program",kolId:"proof-kol",campaignId:"proof-campaign",tokenHash:createHash("sha256").update(token).digest("hex"),challenge:"c",status:"invited" });
});

describe("creator wallet proof binding", () => {
  it("binds the challenge to the same user, invitation and wallet, then consumes it once", async () => {
    const { id,message } = await wallet.beginRecipientChallenge(db,"proof-user",token,address);
    expect(message).toContain(address.toLowerCase());
    await expect(wallet.verifyRecipientChallenge(db,"other-user",id,"0x1234",async()=>true)).rejects.toThrow(/could not be verified/);
    await expect(wallet.verifyRecipientChallenge(db,"proof-user",id,"0x1234",async()=>false)).rejects.toThrow(/could not be verified/);
    await wallet.verifyRecipientChallenge(db,"proof-user",id,"0x1234",async()=>true);
    await expect(wallet.consumeRecipientProof(db,"proof-user","proof-participant","0x2222222222222222222222222222222222222222",id)).rejects.toThrow(/does not match/);
    await expect(wallet.consumeRecipientProof(db,"other-user","proof-participant",address,id)).rejects.toThrow(/does not match/);
    await wallet.consumeRecipientProof(db,"proof-user","proof-participant",address,id);
    await expect(wallet.consumeRecipientProof(db,"proof-user","proof-participant",address,id)).rejects.toThrow(/does not match/);
  });
});
