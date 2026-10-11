import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { userProjects, type CurrentUser } from "@/server/auth/current";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { aiEnabled } from "@/server/integrations/llm";
import { fmtUsdc } from "@/lib/money";
import { balanceMicro, billingMode } from "@/server/domain/billing";
import { servicePriceMicro } from "@/lib/services";
import type { Notice, ShellProps } from "@/lib/shell-types";

/** Everything the app chrome needs, in one place. */
export async function shellData(db: DB, user: CurrentUser, project: typeof s.projects.$inferSelect, role: string): Promise<{ shell: ShellProps; notices: Notice[] }> {
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(s.approvals).where(and(eq(s.approvals.projectId, project.id), eq(s.approvals.status, "pending")));
  const wallet = await getWallet(db, project.id);
  const live = walletIsLive(wallet);
  const walletState = wallet?.frozen ? "frozen" : live ? "live" : "none";
  const walletLabel = { frozen: "Wallet frozen — spend denied", live: `Agent wallet · ${wallet?.address?.slice(0, 6)}…${wallet?.address?.slice(-4)}`, simulation: "Simulation — no wallet", none: "No agent wallet yet" }[walletState];

  const notices: Notice[] = [];
  const approvals = await db.select().from(s.approvals).where(and(eq(s.approvals.projectId, project.id), eq(s.approvals.status, "pending"))).orderBy(desc(s.approvals.createdAt)).limit(5);
  for (const a of approvals) notices.push({ id: a.id, title: a.title, detail: `Waiting for approval · ${fmtUsdc(a.requestedMicro)}`, href: "/app/approvals", tone: "warn" });
  const failed = await db.select().from(s.jobs).where(and(eq(s.jobs.projectId, project.id), eq(s.jobs.status, "failed"), gte(s.jobs.createdAt, new Date(Date.now() - 86_400_000)))).orderBy(desc(s.jobs.createdAt)).limit(3);
  for (const j of failed) notices.push({ id: j.id, title: `${j.kind.replace(/_/g, " ")} job failed`, detail: j.lastError?.slice(0, 80) ?? "See agent runs", href: "/app/runs", tone: "bad" });
  const balance = billingMode() === "off" ? null : await balanceMicro(db, project.ownerId);
  const low = balance != null && balance < servicePriceMicro("scan");
  const isOwner = project.ownerId === user.id;
  if (low)
    notices.push({
      id: "credit",
      title: project.autopilot !== "off" ? "Autopilot is waiting for credit" : "Balance too low for a scan",
      detail: isOwner ? `${fmtUsdc(balance!)} left — top up to keep scanning` : "Ask the workspace owner to top up",
      href: "/billing",
      tone: "warn",
    });
  if (project.dataMode === "LIVE" && !live) notices.push({ id: "wallet", title: "Create the agent wallet", detail: "Spending is disabled until the workspace has a wallet", href: "/app/wallet", tone: "info" });

  return {
    shell: {
      workspace: { id: project.id, name: project.name, dataMode: project.dataMode },
      workspaces: (await userProjects(user.id)).filter((w) => w.onboardingStep >= 5 || w.id === project.id).map((w) => ({ id: w.id, name: w.name, dataMode: w.dataMode, role: w.role })),
      role,
      user: { name: user.name, email: user.email, isGuest: user.isGuest },
      pendingApprovals: pending?.n ?? 0,
      wallet: { state: walletState, label: walletLabel },
      autopilot: project.autopilot,
      claude: aiEnabled(),
      credit: balance == null ? null : { balanceMicro: balance, low, isOwner },
    },
    notices,
  };
}
