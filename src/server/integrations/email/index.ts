import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";

/**
 * Transactional email. Sends through Resend when RESEND_API_KEY and EMAIL_FROM are set.
 * In development without a provider the message is printed to the server console instead;
 * in production without one, sending fails loudly rather than pretending it worked.
 * Every attempt is recorded in email_log (recipient, kind, outcome; never the body).
 */

export type EmailKind = "verify_code" | "reset_code" | "withdraw_code" | "withdrawal" | "welcome" | "subscription_active" | "renewal_reminder" | "payment_failed" | "subscription_canceled" | "credit_added" | "invite" | "report" | "ledger_alert";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body; also rendered into the HTML version. */
  text: string;
  kind: EmailKind;
  userId?: string | null;
  /** Optional primary button in the HTML version. */
  action?: { label: string; url: string };
}

export const emailConfigured = () => !!process.env.RESEND_API_KEY?.trim() && !!process.env.EMAIL_FROM?.trim();
export const emailDevFallback = () => !emailConfigured() && process.env.NODE_ENV !== "production";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal, client-safe HTML: one column, system fonts, the code or link large and obvious. */
export function renderHtml(m: Pick<EmailMessage, "subject" | "text" | "action">): string {
  const paras = m.text
    .split(/\n{2,}/)
    .map((p) => (/^\d{6}$/.test(p.trim()) ? `<p style="font:600 30px/1.2 ui-monospace,Menlo,monospace;letter-spacing:6px;margin:18px 0;color:#2e7d55">${esc(p.trim())}</p>` : `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`))
    .join("");
  const button = m.action
    ? `<p style="margin:20px 0"><a href="${esc(m.action.url)}" style="display:inline-block;background:#0a0b0c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${esc(m.action.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f6f4;padding:24px"><div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e6e3;border-radius:20px;padding:28px;font:15px/1.55 -apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1d2827"><p style="font-weight:700;margin:0 0 18px">GrowTendril</p>${paras}${button}<p style="margin:24px 0 0;font-size:12px;color:#6b7280">You're receiving this because of your GrowTendril account. GrowTendril never asks for your password by email.</p></div></body></html>`;
}

async function log(db: DB, m: EmailMessage, status: "sent" | "failed" | "logged", extra: { providerId?: string; error?: string } = {}) {
  const sensitiveCode = m.kind === "verify_code" || m.kind === "reset_code" || m.kind === "withdraw_code";
  const subject = sensitiveCode ? m.subject.replace(/\b\d{6}\b/g, "[code]") : m.subject;
  const error = sensitiveCode ? extra.error?.replace(/\b\d{6}\b/g, "[code]") : extra.error;
  await db.insert(s.emailLog).values({ id: newId(), userId: m.userId ?? null, to: m.to, kind: m.kind, subject, status, providerId: extra.providerId ?? null, error: error?.slice(0, 500) ?? null });
}

export async function sendEmail(db: DB, m: EmailMessage): Promise<{ delivered: boolean; mode: "resend" | "console" }> {
  if (!emailConfigured()) {
    if (!emailDevFallback()) {
      await log(db, m, "failed", { error: "email not configured" });
      throw new Error("Email delivery isn't configured on this deployment (RESEND_API_KEY and EMAIL_FROM).");
    }
    console.info(`\n[GrowTendril email → ${m.to}] ${m.subject}\n${m.text}\n${m.action ? `${m.action.label}: ${m.action.url}\n` : ""}`);
    await log(db, m, "logged");
    return { delivered: false, mode: "console" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM!.trim(), to: [m.to], subject: m.subject, text: m.text + (m.action ? `\n\n${m.action.label}: ${m.action.url}` : ""), html: renderHtml(m) }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok) throw new Error(body.message ?? `Resend HTTP ${r.status}`);
    await log(db, m, "sent", { providerId: body.id });
    return { delivered: true, mode: "resend" };
  } catch (e) {
    await log(db, m, "failed", { error: (e as Error).message });
    throw new Error(`Couldn't send the email to ${m.to}: ${(e as Error).message}`);
  }
}
