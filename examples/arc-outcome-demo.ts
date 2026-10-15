/** Independent merchant/affiliate consumer. No GrowTendril server, ORM, auth or aliases. */
import { generateKeyPairSync } from "node:crypto";
import assert from "node:assert/strict";
import { calculateReward, reduceCommerce, eligiblePurchase, reserveSpend, executeReservedSpend, verifyTransfers, createReceipt, verifyReceipt, type CommerceEvent, type ReservationStore, type SpendIntent, type SpendPolicy } from "../packages/arc-growth-tools/dist/index.js";

const now = Date.now(), chainId = 5042002;
const contract = `0x${"1".repeat(40)}`, creator = `0x${"2".repeat(40)}`, walletAddress = `0x${"3".repeat(40)}`, txHash = `0x${"4".repeat(64)}`;
const capture: CommerceEvent = { chainId, contract, paymentId: "demo-order", txHash, logIndex: 0, blockNumber: "100", operation: "Charged", amountMicro: 50_000_000, occurredAt: new Date(now - 4*86_400_000).toISOString() };
const order = reduceCommerce([capture,capture]); // Repeated notification earns no second purchase.
const eligible = eligiblePurchase(order, Date.parse(capture.occurredAt), now, 72*3_600_000);
const terms = { baseMicro: 4_000_000, qualityBonusMicro: 3_000_000, outcomeBonusMicro: 1_000_000, outcomeCap: 3 };
const reward = calculateReward(terms, 80, eligible ? 1 : 0);
const intent: SpendIntent = { id: "creator-demo-reward", scope: "affiliate-demo", recipient: creator, asset: "USDC", chainId, amountMicro: reward.totalMicro, category: "creator", expiresAt: now+60_000 };
const policy: SpendPolicy = { frozen:false,allowedChains:[chainId],allowedAssets:["USDC"],allowedRecipients:[creator],allowedCategories:["creator"],hardLimitMicro:10_000_000,budgetMicro:100_000_000,dailyLimitMicro:10_000_000,approvalAboveMicro:0,alwaysReviewCategories:["creator"] };
const entries = new Map<string,{intent:SpendIntent;state:"reserved"|"executing"|"submitted";txHash?:string}>();
let lock=Promise.resolve(), sends=0;
const store: ReservationStore = {
  async locked(_scope,work){const previous=lock;let release!:()=>void;lock=new Promise<void>(r=>{release=r;});await previous;try{return await work();}finally{release();}},
  async get(id){return entries.get(id)??null;},
  async state(){const total=[...entries.values()].reduce((n,e)=>n+e.intent.amountMicro,0);return {committedMicro:total,spentTodayMicro:total};},
  async put(i,state,hash){entries.set(i.id,{intent:i,state,txHash:hash});},
};
assert.equal((await reserveSpend(store,intent,policy,now)).verdict,"APPROVAL_REQUIRED");
const approval={intent,approver:"demo-merchant-owner",approvedAt:now};
await reserveSpend(store,intent,policy,now,approval);
const wallet = { async send(){sends++;return {txHash};} }; // Explicit fixture; no RPC, signature or real payment.
await executeReservedSpend(store,intent,async()=>policy,()=>now,wallet,approval);
await executeReservedSpend(store,intent,async()=>policy,()=>now,wallet,approval);
assert.equal(sends,1);
const checked=verifyTransfers({chainId,asset:"USDC",sender:walletAddress,recipient:creator,amountMicro:reward.totalMicro},{status:"confirmed",chainId,txHash,transfers:[{chainId,asset:"USDC",sender:walletAddress,recipient:creator,amountMicro:reward.totalMicro}]});
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const receipt=createReceipt({dataMode:"SIMULATED",example:"Independent affiliate app",chainId,order,reward,approval:{approver:approval.approver},verification:checked},"affiliate-demo","demo-key",privateKey);
assert.equal(verifyReceipt(receipt,{"demo-key":{issuer:"affiliate-demo",publicKey}}).authenticated,true);
const refunded=reduceCommerce([capture,{...capture,logIndex:1,operation:"Refunded",amountMicro:50_000_000}]);
assert.equal(eligiblePurchase(refunded,Date.parse(capture.occurredAt),now,0),false);
console.log(JSON.stringify({mode:"SIMULATED — no real transactions",purchaseCount:1,rewardMicro:reward.totalMicro,approvalRequired:true,walletCalls:sends,receiptAuthenticated:true,refundedOrderEligible:false},null,2));
