/** Pure helpers for attribution primitives (UTM links + referral codes). */

export const CONVERSION_EVENTS = ["visit", "signup", "lead", "booking", "app_install", "demo_request", "purchase", "refund", "wallet_connect", "sdk_key_created", "sdk_install", "custom"] as const;
export type ConversionEventType = (typeof CONVERSION_EVENTS)[number];

export const EVENT_LABEL: Record<ConversionEventType, string> = {
  visit: "Visit",
  signup: "Signup",
  lead: "Lead / inquiry",
  booking: "Booking / appointment",
  app_install: "App install",
  wallet_connect: "Wallet connect",
  sdk_key_created: "SDK key created",
  sdk_install: "SDK install",
  demo_request: "Demo or quote request",
  purchase: "Purchase",
  refund: "Refund",
  custom: "Custom",
};

export function buildUtmUrl(destination: string, p: { source: string; medium: string; campaign: string; ref: string }): string {
  const u = new URL(destination);
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_medium", p.medium);
  u.searchParams.set("utm_campaign", p.campaign);
  u.searchParams.set("gos_ref", p.ref);
  return u.toString();
}

export function utmSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}
