/** Data contract between the server (queries/shell.ts) and the app chrome components. */
export interface ShellProps {
  workspace: { id: string; name: string; dataMode: string };
  workspaces: { id: string; name: string; dataMode: string; role: string }[];
  role: string;
  user: { name: string; email: string; isGuest: boolean };
  pendingApprovals: number;
  wallet: { state: "live" | "simulation" | "none" | "frozen"; label: string };
  autopilot: string;
  claude: boolean;
  /** The workspace owner's prepaid balance; null while billing is off. */
  credit: { balanceMicro: number; low: boolean; isOwner: boolean } | null;
}

export interface Notice {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "warn" | "bad" | "info";
}
