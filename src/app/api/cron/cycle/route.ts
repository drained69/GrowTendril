import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runOnce } from "@/server/jobs/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * External scheduler hook (`Authorization: Bearer $CRON_SECRET`) for hosts where the in-process
 * worker can't stay alive (serverless). Schedules due autopilot work and drains the job queue.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization") ?? "";
  const got = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  const expected = Buffer.from(secret ?? "");
  if (!secret || got.length !== expected.length || !timingSafeEqual(got, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const processed = await runOnce("cron", 10);
  return NextResponse.json({ processed });
}
