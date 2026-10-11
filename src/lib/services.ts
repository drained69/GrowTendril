/**
 * What GrowTendril charges for. Each service has one fixed price in USDC, deducted from the
 * workspace owner's prepaid balance when it runs. Browsing, settings, team and exports are free.
 * Safe to import from client components (no server dependencies).
 */
export type ServiceKey = "scan" | "creator_report" | "campaign_brief";

export const SERVICES: Record<ServiceKey, { name: string; priceUsdc: number; unit: string; blurb: string }> = {
  scan: {
    name: "Market scan",
    priceUsdc: 2,
    unit: "per scan",
    blurb: "One operator cycle: read your sources, score customers, narratives and creators, update the growth plan and propose experiments. Each autopilot run is one scan.",
  },
  creator_report: {
    name: "Influencer report",
    priceUsdc: 3,
    unit: "per refresh",
    blurb: "Scout new creators, read their profiles and rebuild the report with contact routes and first messages.",
  },
  campaign_brief: {
    name: "Campaign brief",
    priceUsdc: 2,
    unit: "per rewrite",
    blurb: "A fresh campaign brief for one creator. The first draft for every creator is free.",
  },
};

export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];
export const servicePriceMicro = (k: ServiceKey) => Math.round(SERVICES[k].priceUsdc * 1_000_000);

/** Autopilot runs one market scan per interval, so its cadence is also its daily cost. */
export const AUTOPILOT_SCANS_PER_DAY: Record<string, number> = { off: 0, hourly: 24, every_6h: 4, daily: 1 };
export function autopilotCostLabel(cadence: string): string {
  const scans = AUTOPILOT_SCANS_PER_DAY[cadence] ?? 0;
  if (!scans) return "Only when you run it";
  const perDay = scans * SERVICES.scan.priceUsdc;
  return `≈ ${perDay} USDC/day · ${(perDay * 30).toLocaleString("en-US")} USDC/month`;
}

/** Top-ups: any amount from the minimum; the presets are just shortcuts. */
export const MIN_TOPUP_USDC = 2;
export const MAX_TOPUP_USDC = 10_000;
export const TOPUP_PRESETS_USDC = [5, 10, 25, 50];
