/** Mission templates, shared by the onboarding UI and the server action that creates missions. */

export type MissionAudience = "businesses" | "consumers" | "developers";

export interface MissionTemplate {
  key: string;
  name: string;
  /** Conversion event that counts toward the goal. */
  goalEvent: string;
  /** Appended to the goal number, e.g. "100 new users who sign up". */
  goalDescription: string;
  desc: string;
  goal: number;
  days: number;
  budget: string;
  audiences: MissionAudience[];
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  { key: "first_users", name: "First 100 users", goalEvent: "signup", goalDescription: "new users who sign up", desc: "Signups attributed to experiments", goal: 100, days: 14, budget: "200", audiences: ["businesses", "consumers", "developers"] },
  { key: "find_buyers", name: "Find 20 qualified leads", goalEvent: "demo_request", goalDescription: "qualified companies requesting a demo or quote", desc: "Demo, quote or sales requests from in-market companies", goal: 20, days: 14, budget: "100", audiences: ["businesses", "developers"] },
  { key: "first_customers", name: "First 25 customers", goalEvent: "purchase", goalDescription: "paying customers", desc: "Purchases attributed to experiments", goal: 25, days: 30, budget: "300", audiences: ["consumers", "businesses"] },
  { key: "first_bookings", name: "First 30 bookings", goalEvent: "booking", goalDescription: "booked appointments", desc: "Appointments and bookings attributed to experiments", goal: 30, days: 30, budget: "200", audiences: ["consumers", "businesses"] },
  { key: "first_100_devs", name: "First 100 developers", goalEvent: "sdk_key_created", goalDescription: "developers who create an API key", desc: "Verified API key or SDK activations", goal: 100, days: 14, budget: "500", audiences: ["developers"] },
  { key: "own_narrative", name: "Own the conversation", goalEvent: "visit", goalDescription: "qualified visits from the target conversation", desc: "Qualified visits from a conversation your market is having", goal: 1000, days: 30, budget: "300", audiences: ["businesses", "consumers", "developers"] },
  { key: "kol_discovery", name: "Creator partnerships", goalEvent: "signup", goalDescription: "signups from validated creator campaigns", desc: "Signups from creators your audience already trusts", goal: 30, days: 14, budget: "50", audiences: ["businesses", "consumers", "developers"] },
];

export const MISSION_KEYS = MISSION_TEMPLATES.map((t) => t.key) as [string, ...string[]];

export const missionTemplate = (key: string) => MISSION_TEMPLATES.find((t) => t.key === key);

/** Businesses whose customers book a time rather than buy a product. */
const BOOKING_CATEGORIES = ["Healthcare", "Home & local services", "Travel & hospitality", "Health & wellness", "Agency & professional services"];

/**
 * Templates that fit this audience; the most audience-specific ones first. Service businesses
 * (a clinic, a salon, a dog walker) start with bookings; everyone else doesn't see that goal first.
 */
export function templatesFor(audience: string | null | undefined, category?: string | null): MissionTemplate[] {
  const a: MissionAudience = audience === "consumers" || audience === "developers" ? audience : "businesses";
  const books = !!category && BOOKING_CATEGORIES.some((c) => category.split(" · ")[0] === c);
  const fit = MISSION_TEMPLATES.filter((t) => t.audiences.includes(a)).sort((x, y) => x.audiences.length - y.audiences.length);
  const bookings = fit.filter((t) => t.key === "first_bookings");
  const rest = fit.filter((t) => t.key !== "first_bookings");
  return books ? [...bookings, ...rest] : [...rest, ...bookings];
}
