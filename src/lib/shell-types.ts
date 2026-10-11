/** Data contract between the server (queries/shell.ts) and the app chrome components. */
export interface ShellProps {
  workspace: { id: string; name: string; dataMode: string };
  workspaces: { id: string; name: string; dataMode: string; role: string }[];
  role: string;
  /** guestExpires: server-computed label for when a guest account is removed (null for real users). */
  user: { name: string; email: string; isGuest: boolean; guestExpires: string | null };
  pendingApprovals: number;
  wallet: { state: "live" | "simulation" | "none" | "frozen"; label: string };
  autopilot: string;
  claude: boolean;
  network: { name: string; mainnet: boolean };
}

export interface Notice {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "warn" | "bad" | "info";
}
