import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { COMMERCE_ABI } from "../packages/arc-growth-tools/src/commerce-abi";
import type { DB } from "@/server/db/client";
import { type CommerceEvent } from "../packages/arc-growth-tools/src/commerce";
process.env.PGLITE_DIR = "memory://";
let db: DB, s: typeof import("@/server/db/schema"), flow: typeof import("@/server/domain/growth/commerce");
const contract = `0x${"1".repeat(40)}`, merchantAddress = `0x${"3".repeat(40)}`, paymentId = `0x${"4".repeat(64)}`;
const event = (operation: CommerceEvent["operation"], amountMicro: number, n: number): CommerceEvent => ({ operation, amountMicro, chainId: 5042002, contract, paymentId, txHash: `0x${n.toString().padStart(64,"0")}`, logIndex: 0, blockNumber: String(n), occurredAt: new Date(1_700_000_000_000+n*1000).toISOString() });
beforeAll(async () => {
  const client = await import("@/server/db/client"); db = await client.getDb(); s = client.schema; flow = await import("@/server/domain/growth/commerce");
  await db.insert(s.users).values({ id: "owner", email: "owner@example.test", name: "Owner" });
  await db.insert(s.projects).values(["one","two"].map(id => ({ id, ownerId: "owner", name: id, webhookSecret: "secret" })));
  await flow.saveCommerceConnection(db, "one", "owner", { chainId: 5042002, contract, merchantAddress });
});
const report = (events: CommerceEvent[]) => ({ orderId: "merchant-order1", customerId: "opaque-customer", paymentId, events: events.map(e => ({ txHash: e.txHash, logIndex: e.logIndex })) });
async function ingest(events: CommerceEvent[]) { return flow.ingestCommerce(db, "one", report(events), async () => events); }
describe("merchant connector transaction boundaries", () => {
  it("decodes the actual Circle charge event and rejects a different merchant", () => {
    const definition = COMMERCE_ABI.find(e => e.name === "PaymentCharged")!;
    const paymentInfo = { operator:contract, payer:contract, receiver:merchantAddress, token:"0x3600000000000000000000000000000000000000", maxAmount:100n, preApprovalExpiry:0, authorizationExpiry:0, refundExpiry:0, minFeeBps:0, maxFeeBps:0, feeReceiver:contract, salt:1n };
    const topics = encodeEventTopics({ abi:COMMERCE_ABI,eventName:"PaymentCharged",args:{paymentInfoHash:paymentId as Hex} }) as readonly Hex[];
    const data = encodeAbiParameters(definition.inputs.filter(x => !x.indexed),[paymentInfo,100n,contract,0,contract]);
    const pointer = { txHash:event("Charged",100,10).txHash,logIndex:0 };
    const decoded = flow.decodeCommercePaymentLog({chainId:5042002,contract,merchantAddress},paymentId,pointer,{topics,data},10n,new Date().toISOString());
    expect(decoded).toMatchObject({operation:"Charged",amountMicro:100,paymentId});
    expect(() => flow.decodeCommercePaymentLog({chainId:5042002,contract,merchantAddress:`0x${"5".repeat(40)}`},paymentId,pointer,{topics,data},10n,new Date().toISOString())).toThrow(/merchant receiver/);
  });
  it("records a full capture once across concurrent notifications", async () => {
    const a = event("Authorized", 100, 1), c = event("Captured", 100, 2);
    await Promise.all([ingest([a,c]), ingest([c,a])]);
    const purchases = await db.select().from(s.conversionEvents).where(eq(s.conversionEvents.eventType,"purchase"));
    expect(purchases).toHaveLength(1); expect(purchases[0]).toMatchObject({ valueMicro: 100, dataMode: "TESTNET", source: "webhook" });
    expect(await db.select().from(s.commerceEvents)).toHaveLength(2);
  });
  it("records refunds separately without duplicating net adjustments", async () => {
    const r = event("Refunded", 25, 3);
    await ingest([r]); await ingest([r]);
    const refunds = await db.select().from(s.conversionEvents).where(eq(s.conversionEvents.eventType,"refund"));
    expect(refunds).toHaveLength(1); expect(refunds[0].valueMicro).toBe(25);
    expect((await db.select().from(s.commerceOrders))[0]).toMatchObject({ capturedMicro: 100, refundedMicro: 25, status: "partially_refunded" });
  });
  it("rolls back invalid captures and conflicting order identity", async () => {
    await expect(ingest([event("Captured", 10, 4)])).rejects.toThrow(/exceeds/);
    expect(await db.select().from(s.commerceEvents)).toHaveLength(3);
    const r = event("Refunded", 1, 5);
    await expect(flow.ingestCommerce(db,"one",{ ...report([r]), customerId:"another-person" },async()=>[r])).rejects.toThrow(/identity/);
    expect((await db.select().from(s.commerceOrders))[0].refundedMicro).toBe(25);
  });
  it("does not permit changing the network or minting orders in another workspace", async () => {
    await expect(flow.saveCommerceConnection(db,"one","owner",{chainId:5042002,contract,merchantAddress:`0x${"5".repeat(40)}`})).rejects.toThrow(/already has orders/);
    await expect(flow.ingestCommerce(db,"two",report([event("Charged",10,6)]),async()=>[event("Charged",10,6)])).rejects.toThrow(/Configure/);
  });
});
