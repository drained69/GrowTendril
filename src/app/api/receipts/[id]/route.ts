import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { canonicalJson, sha256 } from "@/server/lib/ids";
import { portableReceipt } from "@/server/domain/agent/portable-receipts";
import { writeReceipt } from "@/server/domain/agent/decisions";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { project, db } = await requireProject();
  const { id } = await params;
  let [receipt] = await db.select().from(s.decisionReceipts).where(and(eq(s.decisionReceipts.projectId, project.id), eq(s.decisionReceipts.decisionId, id)));
  if (!receipt) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (sha256(canonicalJson(receipt.body)) !== receipt.digest) return NextResponse.json({ error: "stored receipt digest mismatch" }, { status: 409 });
  const [tx] = await db.select().from(s.transactions).where(and(eq(s.transactions.projectId, project.id), eq(s.transactions.decisionId, id)));
  const payment = (receipt.body as { payment?: { state?: string; chainCheck?: string | null } }).payment;
  if (tx && (payment?.state !== tx.state || (payment.chainCheck ?? null) !== (tx.chainCheck ?? null))) {
    // Older receipts can predate an exception migration. Rebuild from the ledger before signing an export.
    await writeReceipt(db, id);
    [receipt] = await db.select().from(s.decisionReceipts).where(and(eq(s.decisionReceipts.projectId, project.id), eq(s.decisionReceipts.decisionId, id)));
    if (!receipt || sha256(canonicalJson(receipt.body)) !== receipt.digest) return NextResponse.json({ error: "receipt refresh failed" }, { status: 409 });
  }
  return NextResponse.json(portableReceipt({ ...receipt.body, workspaceId: project.id, decisionId: id, exportedAt: new Date().toISOString(), finalizedAt: receipt.finalizedAt?.toISOString() ?? null }), { headers: { "cache-control": "private, no-store", "content-disposition": 'attachment; filename="arc-growth-receipt.json"' } });
}
