import { servicePriceMicro, SERVICES } from "@/lib/services";

export interface GrowthStepState {
  hasProfile: boolean;
  hasMission: boolean;
  readySources: number;
  scanStatus: "queued" | "running" | null;
  hasScanned: boolean;
  creditMicro: number | null;
  pendingApprovals: number;
  opportunityHref?: string;
  permissions: { operate: boolean; approve: boolean; manageProfile: boolean; managePolicy: boolean; manageIntegrations: boolean; ownsCredit: boolean };
}

type Copy = { title: string; detail: string; label: string };
export type GrowthStep = Copy & ({ kind: "link"; href: string } | { kind: "scan" });

/** Guide the user with observed state. Wallet setup is only needed when paying people. */
export function nextGrowthStep(s: GrowthStepState): GrowthStep {
  if (s.pendingApprovals > 0) return { kind: "link", title: "A spending decision needs attention", detail: `${s.pendingApprovals} request${s.pendingApprovals === 1 ? " is" : "s are"} waiting for review. Inspect the recipient, amount and reason before proceeding.`, label: s.permissions.approve ? "Review requests" : "View requests", href: "/app/approvals" };
  if (s.scanStatus) return { kind: "link", title: s.scanStatus === "queued" ? "Your market scan is queued" : "Your market scan is running", detail: "Follow its progress and collected evidence in Agent runs. Recommendations appear after the scan completes.", label: "View scan progress", href: "/app/runs" };
  if (!s.permissions.operate) return { kind: "link", title: "Catch up on the growth plan", detail: "Review the team's recommended actions and the evidence behind them. A workspace operator can run scans and start tests.", label: "View growth plan", href: "/app/plan" };
  if (!s.hasProfile) return { kind: "link", title: "Give discovery the right product context", detail: "Add or review what you sell and who it is for. The product profile determines which conversations the operator searches.", label: s.permissions.manageProfile ? "Review product profile" : "Contact the owner", href: s.permissions.manageProfile ? "/app/settings#profile" : "/app/team" };
  if (!s.hasMission) return { kind: "link", title: "Choose your growth goal", detail: "Set a measurable target, timeframe and budget to give the next recommendations a clear purpose.", label: s.permissions.managePolicy ? "Set a goal" : "Contact an admin", href: s.permissions.managePolicy ? "/onboarding?step=3" : "/app/team" };
  if (s.readySources === 0) return { kind: "link", title: "Connect a source to find real opportunities", detail: "Discovery needs an available source for your audience. Check source status before paying for a scan.", label: s.permissions.manageIntegrations ? "Review sources" : "Contact an admin", href: s.permissions.manageIntegrations ? "/app/integrations" : "/app/team" };
  if (s.opportunityHref) return { kind: "link", title: "Review your strongest opportunity", detail: "Start with the highest-priority open opportunity. Inspect its evidence and proposed action, then decide whether to test it.", label: "Review opportunity", href: s.opportunityHref };
  if (s.creditMicro != null && s.creditMicro < servicePriceMicro("scan")) return { kind: "link", title: "Add service credit for the next scan", detail: `A market scan costs ${SERVICES.scan.priceUsdc} USDC. Service credit is separate from the wallet used to pay creators.`, label: s.permissions.ownsCredit ? "Add service credit" : "Contact the workspace owner", href: s.permissions.ownsCredit ? "/billing" : "/app/team" };
  if (s.hasScanned) return { kind: "link", title: "Refine the search before your next test", detail: "The scan has not produced an open opportunity yet. Review source evidence and adjust the product's search terms where needed.", label: s.permissions.manageProfile ? "Review search terms" : "Browse evidence", href: s.permissions.manageProfile ? "/app/settings#profile" : "/app/discover" };
  return { kind: "scan", title: "Find your first growth opportunity", detail: "Read the connected sources, rank relevant signals and prepare recommendations you can review.", label: "Find opportunities" };
}
