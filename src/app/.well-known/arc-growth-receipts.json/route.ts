import { NextResponse } from "next/server";
import { receiptIssuer } from "@/server/domain/agent/portable-receipts";
export const dynamic = "force-dynamic";
export function GET() {
  const { issuer, keyId, publicKey } = receiptIssuer();
  return NextResponse.json({ schema: "arc-growth-receipt/v1", issuer, keys: publicKey ? [{ keyId, algorithm: "Ed25519", publicKey }] : [], signingConfigured: !!publicKey }, { headers: { "cache-control": "no-store" } });
}
