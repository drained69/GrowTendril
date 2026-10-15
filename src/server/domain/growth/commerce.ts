import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createPublicClient, decodeEventLog, http, type Hash, type Hex } from "viem";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ARC } from "@/server/integrations/circle/config";
import { newId } from "@/server/lib/ids";
import { audit } from "@/server/db/helpers";
import { recordConversion } from "@/server/domain/growth/attribution";
import { commerceEventKey, reduceCommerce, type CommerceEvent } from "@arc-growth/commerce";
import { COMMERCE_ABI } from "@arc-growth/commerce-abi";

const address = z.string().regex(/^0x[\da-f]{40}$/i).refine(v => !/^0x0{40}$/i.test(v), "Use a nonzero address").transform(v => v.toLowerCase());
export const CommerceSettings = z.object({ chainId: z.coerce.number().refine(n => n === ARC.chainId || n === 5042002, "Select Arc mainnet or testnet"), contract: address, merchantAddress: address });
export const CommerceReport = z.object({
  orderId: z.string().trim().min(1).max(160), paymentId: z.string().regex(/^0x[\da-f]{64}$/i).transform(v => v.toLowerCase()),
  customerId: z.string().trim().min(1).max(200), ref: z.string().regex(/^[a-z0-9]{6,16}$/).optional(),
  events: z.array(z.object({ txHash: z.string().regex(/^0x[\da-f]{64}$/i), logIndex: z.number().int().nonnegative() })).min(1).max(20),
});
export type Report = z.infer<typeof CommerceReport>;
export type Connection = typeof s.commerceConnections.$inferSelect;

/** Interpret a log only after its receipt, block and contract address have been checked. */
export function decodeCommercePaymentLog(connection: Pick<Connection,"chainId"|"contract"|"merchantAddress">, paymentId: string, pointer: {txHash:string;logIndex:number}, log: {topics: readonly Hex[];data: Hex}, blockNumber: bigint, occurredAt: string): CommerceEvent {
  const decoded = decodeEventLog({ abi: COMMERCE_ABI, topics: log.topics as [Hex,...Hex[]], data: log.data, strict: true });
  if (!decoded.eventName.startsWith("Payment")) throw new Error("Log is not a payment event");
  const args = decoded.args as unknown as { paymentInfoHash: string; amount: bigint; paymentInfo?: { token: string; receiver: string } };
  if (args.paymentInfoHash.toLowerCase() !== paymentId) throw new Error("Event belongs to a different payment");
  const asset = "0x3600000000000000000000000000000000000000";
  if (args.paymentInfo && (args.paymentInfo.token.toLowerCase() !== asset || args.paymentInfo.receiver.toLowerCase() !== connection.merchantAddress)) throw new Error("Payment asset or merchant receiver does not match");
  const amountMicro = Number(args.amount);
  if (!Number.isSafeInteger(amountMicro) || amountMicro < 0) throw new Error("Payment amount exceeds supported precision");
  return { chainId: connection.chainId, contract: connection.contract, paymentId, txHash: pointer.txHash.toLowerCase(), logIndex: pointer.logIndex, blockNumber: blockNumber.toString(), operation: decoded.eventName.replace(/^Payment/, "") as CommerceEvent["operation"], amountMicro, occurredAt };
}

export async function saveCommerceConnection(db: DB, projectId: string, actorId: string, input: unknown) {
  const v = CommerceSettings.parse(input);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${projectId}`}))`);
    const [old] = await tx.select().from(s.commerceConnections).where(eq(s.commerceConnections.projectId, projectId));
    const [order] = await tx.select({ id: s.commerceOrders.id }).from(s.commerceOrders).where(eq(s.commerceOrders.projectId, projectId)).limit(1);
    if (order && old && (old.chainId !== v.chainId || old.contract !== v.contract || old.merchantAddress !== v.merchantAddress)) throw new Error("This connection already has orders. Keep its network and merchant identity so refunds can be reconciled.");
    await tx.insert(s.commerceConnections).values({ projectId, ...v }).onConflictDoUpdate({ target: s.commerceConnections.projectId, set: { ...v, status: "connected", updatedAt: new Date() } });
    await audit(tx as unknown as DB, { projectId, actorType: "user", actorId, action: "commerce.connect", target: projectId, data: v });
  });
}

/** The merchant submits log pointers; all payment facts come from the pinned chain and contract. */
export async function verifyCommerceEvents(connection: Connection, report: Report): Promise<CommerceEvent[]> {
  const testnet = connection.chainId === 5042002;
  const client = createPublicClient({ transport: http(testnet ? process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.io" : ARC.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  if (await client.getChainId() !== connection.chainId) throw new Error("RPC network does not match the connection");
  const out: CommerceEvent[] = [];
  const receipts = new Map<string, Awaited<ReturnType<typeof client.getTransactionReceipt>>>();
  for (const pointer of report.events) {
    let receipt = receipts.get(pointer.txHash);
    if (!receipt) { receipt = await client.getTransactionReceipt({ hash: pointer.txHash as Hash }); receipts.set(pointer.txHash, receipt); }
    if (receipt.status !== "success") throw new Error("Payment transaction reverted");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) throw new Error("Payment receipt is not on the canonical chain");
    const log = receipt.logs.find(l => l.logIndex === pointer.logIndex && l.address.toLowerCase() === connection.contract);
    if (!log) throw new Error("Payment event is not from the connected escrow contract");
    out.push(decodeCommercePaymentLog(connection, report.paymentId, pointer, log, receipt.blockNumber, new Date(Number(block.timestamp) * 1000).toISOString()));
  }
  return out;
}

/** Atomic replay, order update, conversion emission and checkpoint. Verification is never supplied by the HTTP caller. */
export async function ingestCommerce(db: DB, projectId: string, input: unknown, verify = verifyCommerceEvents) {
  const report = CommerceReport.parse(input);
  const [connection] = await db.select().from(s.commerceConnections).where(eq(s.commerceConnections.projectId, projectId));
  if (!connection || connection.status !== "connected") throw new Error("Configure the merchant connection first");
  const verified = await verify(connection, report);
  if (verified.length !== report.events.length) throw new Error("Incomplete payment verification");
  return db.transaction(async transaction => {
    const db = transaction as unknown as DB;
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${projectId}`}))`);
    const [current] = await db.select().from(s.commerceConnections).where(eq(s.commerceConnections.projectId, projectId));
    if (!current || current.status !== "connected" || current.chainId !== connection.chainId || current.contract !== connection.contract || current.merchantAddress !== connection.merchantAddress) throw new Error("Connection changed during verification");
    if (report.ref) {
      const [link] = await db.select({ projectId: s.experiments.projectId }).from(s.campaigns).innerJoin(s.experiments, eq(s.experiments.id, s.campaigns.experimentId)).where(eq(s.campaigns.referralCode, report.ref));
      if (!link || link.projectId !== projectId) throw new Error("Referral does not belong to this workspace");
    }
    let [order] = await db.select().from(s.commerceOrders).where(and(eq(s.commerceOrders.projectId, projectId), eq(s.commerceOrders.paymentId, report.paymentId), eq(s.commerceOrders.chainId, connection.chainId), eq(s.commerceOrders.contract, connection.contract)));
    const dataMode = connection.chainId === 5042002 ? "TESTNET" as const : "LIVE" as const;
    if (order && (order.merchantOrderId !== report.orderId || order.customerId !== report.customerId || order.referralCode !== (report.ref ?? null))) throw new Error("Order attribution and identity cannot change after registration");
    if (!order) {
      if (!verified.some(e => e.operation === "Authorized" || e.operation === "Charged")) throw new Error("Report the authorization or charge before later operations");
      [order] = await db.insert(s.commerceOrders).values({ id: newId(), projectId, paymentId: report.paymentId, merchantOrderId: report.orderId, customerId: report.customerId, referralCode: report.ref ?? null, chainId: connection.chainId, contract: connection.contract, dataMode }).returning();
    }
    for (const e of verified) {
      const eventKey = commerceEventKey(e);
      const [existing] = await db.select().from(s.commerceEvents).where(and(eq(s.commerceEvents.projectId, projectId), eq(s.commerceEvents.eventKey, eventKey)));
      if (existing && (existing.orderId !== order.id || JSON.stringify(existing.body) !== JSON.stringify(e))) {
        // PostgreSQL jsonb key order is not stable; compare canonical fields instead.
        if (existing.orderId !== order.id || Object.entries(e).some(([k,v]) => existing.body[k] !== v)) throw new Error("Conflicting chain event replay");
      }
      await db.insert(s.commerceEvents).values({ id: newId(), projectId, orderId: order.id, eventKey, body: { ...e } }).onConflictDoNothing();
    }
    const history = await db.select().from(s.commerceEvents).where(and(eq(s.commerceEvents.projectId, projectId), eq(s.commerceEvents.orderId, order.id)));
    const events = history.map(h => h.body as unknown as CommerceEvent);
    const state = reduceCommerce(events);
    await db.update(s.commerceOrders).set({ ...state, updatedAt: new Date() }).where(eq(s.commerceOrders.id, order.id));
    // A purchase is a fully captured order. Emit its gross value once; refunds are separate facts.
    const fullCapture = state.authorizedMicro > 0 && state.capturedMicro === state.authorizedMicro;
    const metadata = { orderId: `commerce:${order.id}`, merchantOrderId: order.merchantOrderId, commerce: true, paymentId: report.paymentId, chainId: connection.chainId, contract: connection.contract, evidence: "chain_confirmed", attribution: "merchant_attested" };
    if (fullCapture) {
      const at = events.filter(e => e.operation === "Captured" || e.operation === "Charged").sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
      await recordConversion(db, { projectId, eventType: "purchase", visitorId: report.customerId, referralCode: report.ref, idempotencyKey: `commerce:purchase:${order.id}`, valueMicro: state.capturedMicro, occurredAt: new Date(at.occurredAt), source: "webhook", dataMode, metadata });
    }
    for (const e of events.filter(e => e.operation === "Refunded")) await recordConversion(db, { projectId, eventType: "refund", visitorId: report.customerId, referralCode: report.ref, idempotencyKey: `commerce:refund:${projectId}:${commerceEventKey(e)}`, valueMicro: e.amountMicro, occurredAt: new Date(e.occurredAt), source: "webhook", dataMode, metadata: { ...metadata, txHash: e.txHash, logIndex: e.logIndex } });
    await db.update(s.commerceConnections).set({ lastEventAt: new Date() }).where(eq(s.commerceConnections.projectId, projectId));
    return { orderId: order.id, ...state, dataMode, events: history.length };
  });
}

export async function commerceSummary(db: DB, projectId: string) {
  const [connection] = await db.select().from(s.commerceConnections).where(eq(s.commerceConnections.projectId, projectId));
  const orders = await db.select().from(s.commerceOrders).where(eq(s.commerceOrders.projectId, projectId)).orderBy(desc(s.commerceOrders.updatedAt)).limit(50);
  return { connection: connection ?? null, orders };
}
