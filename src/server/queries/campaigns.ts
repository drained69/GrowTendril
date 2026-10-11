import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { campaignLedger, type Campaign, type CampaignLedger } from "@/server/domain/growth/creator-campaigns";

/** Read-only helpers for the creator campaign pages. Nothing here writes. */

/** Absolute origin for share links: APP_URL when configured, else the request's forwarded host. */
export async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}

/** Inside the posting window and not closed — the same rule the domain uses to accept joins and posts. */
export function campaignIsOpen(c: Campaign, now = Date.now()): boolean {
  return c.status === "open" && now >= c.startsAt.getTime() && now <= c.endsAt.getTime();
}

/** Human status: a campaign whose window ended but wasn't closed still settles verified actions. */
export function campaignStatus(c: Campaign, now = Date.now()): { key: string; label: string } {
  if (c.status === "closed") return { key: "closed", label: "Closed" };
  if (now < c.startsAt.getTime()) return { key: "pending", label: "Scheduled" };
  if (now > c.endsAt.getTime()) return { key: "ended", label: "Window ended" };
  return { key: "open", label: "Open" };
}

export interface CampaignListRow {
  campaign: Campaign;
  ledger: CampaignLedger;
  accepted: number;
  applied: number;
}

export async function listCampaigns(db: DB, projectId: string): Promise<CampaignListRow[]> {
  const rows = await db.select().from(s.creatorCampaigns).where(eq(s.creatorCampaigns.projectId, projectId)).orderBy(desc(s.creatorCampaigns.number));
  return Promise.all(
    rows.map(async (c) => {
      const ledger = await campaignLedger(db, c);
      const status = ledger.creators.map((x) => x.participant.status);
      return { campaign: c, ledger, accepted: status.filter((x) => x === "accepted").length, applied: status.filter((x) => x === "applied").length };
    }),
  );
}

export async function campaignPostsFor(db: DB, campaignId: string) {
  return db.select().from(s.campaignPosts).where(eq(s.campaignPosts.campaignId, campaignId)).orderBy(desc(s.campaignPosts.submittedAt));
}

export async function participantPosts(db: DB, participantId: string) {
  return db.select().from(s.campaignPosts).where(eq(s.campaignPosts.participantId, participantId)).orderBy(desc(s.campaignPosts.submittedAt));
}

/** The referral code behind a creator's own tracking link (`/r/<code>`), once they're accepted. */
export async function trackingReferralCode(db: DB, trackingCampaignId: string | null): Promise<string | null> {
  if (!trackingCampaignId) return null;
  const [row] = await db.select({ code: s.campaigns.referralCode }).from(s.campaigns).where(eq(s.campaigns.id, trackingCampaignId));
  return row?.code ?? null;
}

/** Window dates as plain UTC calendar dates (server and client render the same string). */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function fmtPct(share: number): string {
  if (!share) return "0%";
  const p = share * 100;
  return `${p < 1 ? p.toFixed(1) : Math.round(p)}%`;
}
