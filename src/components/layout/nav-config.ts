import { Activity, Bot, Handshake, Building2, FlaskConical, Flag, LayoutDashboard, Megaphone, Network, Newspaper, PlayCircle, Plug, Radar, Receipt, Settings, ShieldCheck, Target, TrendingUp, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "approvals";
  demoOnly?: boolean;
  keywords?: string;
}

export const NAV: { section: string | null; items: NavItem[] }[] = [
  {
    section: null,
    items: [
      { href: "/app", label: "Overview", icon: LayoutDashboard, keywords: "home dashboard mission" },
      { href: "/app/brief", label: "Daily brief", icon: Newspaper, keywords: "report summary today" },
      { href: "/app/demo", label: "Guided demo", icon: PlayCircle, demoOnly: true },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { href: "/app/discover", label: "Discover", icon: Radar, keywords: "feed posts sources research" },
      { href: "/app/customers", label: "Customers", icon: Building2, keywords: "companies intent leads" },
      { href: "/app/narratives", label: "Narratives", icon: TrendingUp, keywords: "trends topics market" },
      { href: "/app/kols", label: "Creators", icon: Megaphone, keywords: "kol influencers voices" },
      { href: "/app/graph", label: "Growth graph", icon: Network },
    ],
  },
  {
    section: "Growth",
    items: [
      { href: "/app/opportunities", label: "Opportunities", icon: Target },
      { href: "/app/missions", label: "Missions", icon: Flag, keywords: "goal budget" },
      { href: "/app/campaigns", label: "Creator campaigns", icon: Handshake, keywords: "creators opt-in posts rewards payouts mindshare" },
      { href: "/app/experiments", label: "Experiments", icon: FlaskConical, keywords: "tests stop conditions" },
    ],
  },
  {
    section: "Money",
    items: [
      { href: "/app/wallet", label: "Wallet", icon: Wallet, keywords: "balance gateway usdc deposit" },
      { href: "/app/approvals", label: "Approvals", icon: ShieldCheck, badge: "approvals", keywords: "inbox spend" },
      { href: "/app/activity", label: "Arc / Circle activity", icon: Activity, keywords: "transactions x402 settlements receipts" },
      { href: "/app/receipts", label: "Receipts", icon: Receipt, keywords: "decisions audit hash" },
      { href: "/app/runs", label: "Agent runs", icon: Bot, keywords: "jobs autopilot logs" },
    ],
  },
  {
    section: "Workspace",
    items: [
      { href: "/app/integrations", label: "Integrations", icon: Plug, keywords: "api keys x reddit youtube github webhook" },
      { href: "/app/team", label: "Team", icon: Users, keywords: "members invite roles" },
      { href: "/app/settings", label: "Settings", icon: Settings, keywords: "policy profile icp limits" },
    ],
  },
];

export const ALL_NAV = NAV.flatMap((g) => g.items);

/** Label for a path, used by breadcrumbs. */
export function navLabel(path: string): string | null {
  const exact = ALL_NAV.find((n) => n.href === path);
  if (exact) return exact.label;
  const prefix = [...ALL_NAV].sort((a, b) => b.href.length - a.href.length).find((n) => n.href !== "/app" && path.startsWith(n.href));
  return prefix?.label ?? null;
}
