import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { platformCustody } from "@/server/integrations/circle/config";
import { aiProvider } from "@/server/integrations/llm";
import { emailConfigured } from "@/server/integrations/email";
import { billingMode } from "@/server/domain/billing";
import { googleConfigured } from "@/server/auth/google";
import { circleAuth } from "@/server/integrations/circle/auth-check";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    // `circleAuth` is the live check: "rejected" means wallets and payments are down until CIRCLE_API_KEY is fixed.
    return NextResponse.json({ ok: true, custody: platformCustody(), circleAuth: await circleAuth(), ai: aiProvider() ?? false, email: emailConfigured(), billing: billingMode(), google: googleConfigured() });
  } catch (error) {
    console.error("[GrowTendril health] database unavailable", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
