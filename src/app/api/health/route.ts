import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { ARC, platformCustody } from "@/server/integrations/circle/config";
import { claudeEnabled } from "@/server/integrations/llm/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  await getDb();
  return NextResponse.json({ ok: true, network: ARC.network, chainId: ARC.chainId, custody: platformCustody(), claude: claudeEnabled() });
}
