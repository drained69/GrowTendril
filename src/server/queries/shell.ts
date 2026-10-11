import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { userProjects, type CurrentUser } from "@/server/auth/current";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { ARC, IS_MAINNET } from "@/server/integrations/circle/config";
import { claudeEnabled } from "@/server/integrations/llm/claude";
import { fmtUsdc } from "@/lib/money";
import type { Notice, ShellProps } from "@/lib/shell-types";

const GUEST_TTL_MS = 7 * 86_400_000;

/** Everything the app chrome needs, in one place. */
export async function shellData(db: DB, user: CurrentUser, project: typeof s.projects.$inferSelect, role: string): Promise<{ shell: ShellProps; notices: Notice[] }> {
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(s.approvals).where(and(eq(s.approvals.projectId, project.id), eq(s.approvals.status, "pending")));
  const wallet = await getWallet(db, project.id);
  const live = walletIsLive(wallet);
  const walletState = wallet?.frozen ? "frozen" : live ? "live" : project.dataMode === "DEMO" ? "simulation" : "none";
  const walletLabel = { frozen: "Wallet frozen — spend denied", live: `Agent wallet · ${wallet?.address?.slice(0, 6)}…${wallet?.address?.slice(-4)}`, simulation: "Simulation — no wallet", none: "No agent wallet yet" }[walletState];

  // Guest accounts are deleted by the cleanup job 7 days after creation (jobs/handlers.ts).
  let guestExpires: string | null = null;
  if (user.isGuest) {
    const [u] = await db.select({ createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, user.id));
    const days = u ? Math.ceil((u.createdAt.getTime() + GUEST_TTL_MS - Date.now()) / 86_400_000) : null;
    guestExpires = days == null ? null : days <= 1 ? "expires within a day" : `expires in ${days} days`;
  }

  const notices: Notice[] = [];
  const approvals = await db.select().from(s.approvals).where(and(eq(s.approvals.projectId, project.id), eq(s.approvals.status, "pending"))).orderBy(desc(s.approvals.createdAt)).limit(5);
  for (const a of approvals) notices.push({ id: a.id, title: a.title, detail: `Waiting for approval · ${fmtUsdc(a.requestedMicro)}`, href: "/app/approvals", tone: "warn" });
  const failed = await db.select().from(s.jobs).where(and(eq(s.jobs.projectId, project.id), eq(s.jobs.status, "failed"), gte(s.jobs.createdAt, new Date(Date.now() - 86_400_000)))).orderBy(desc(s.jobs.createdAt)).limit(3);
  for (const j of failed) notices.push({ id: j.id, title: `${j.kind.replace(/_/g, " ")} job failed`, detail: j.lastError?.slice(0, 80) ?? "See agent runs", href: "/app/runs", tone: "bad" });
  if (project.dataMode === "LIVE" && !live) notices.push({ id: "wallet", title: "Create the agent wallet", detail: "Spending is disabled until the workspace has a wallet", href: "/app/wallet", tone: "info" });

  return {
    shell: {
      workspace: { id: project.id, name: project.name, dataMode: project.dataMode },
      workspaces: (await userProjects(user.id)).filter((w) => w.onboardingStep >= 5 || w.id === project.id).map((w) => ({ id: w.id, name: w.name, dataMode: w.dataMode, role: w.role })),
      role,
      user: { name: user.name, email: user.email, isGuest: user.isGuest, guestExpires },
      pendingApprovals: pending?.n ?? 0,
      wallet: { state: walletState, label: walletLabel },
      autopilot: project.autopilot,
      claude: claudeEnabled(),
      network: { name: ARC.name, mainnet: IS_MAINNET },
    },
    notices,
  };
}
