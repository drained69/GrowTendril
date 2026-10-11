export const DAY_MS = 86_400_000;

export const daysAgo = (n: number, from = Date.now()) => new Date(from - n * DAY_MS);

export function relTime(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Math.round((now - t) / 1000);
  // Future dates (an invite's expiry, an experiment's end) read "in 7d", not "-604800s ago".
  const s = Math.abs(diff);
  const span = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  if (diff < 0) return s < 5 ? "now" : `in ${span}`;
  return s < 5 ? "just now" : `${span} ago`;
}

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Start of the current UTC day — the window for DAILY_SPEND. */
export function startOfUtcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
