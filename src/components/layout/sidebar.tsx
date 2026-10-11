"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, Coins, LogOut, Plus } from "lucide-react";
import { ALL_NAV, NAV } from "@/components/layout/nav-config";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Logo } from "@/components/layout/logo";
import type { ShellProps } from "@/lib/shell-types";
import { logoutAction, switchProjectAction } from "@/server/actions/auth";

export type { ShellProps };

function WorkspaceSwitcher({ workspace, workspaces, isGuest }: Pick<ShellProps, "workspace" | "workspaces"> & { isGuest: boolean }) {
  return (
    <Menu
      align="start"
      width={248}
      trigger={(open) => (
        <button className={cn("flex w-full items-center gap-2.5 rounded-[14px] bg-surface px-2.5 py-2 text-left shadow-[var(--shadow-card)] ring-1 ring-line transition-[box-shadow,transform] hover:-translate-y-px hover:ring-line-strong", open && "ring-line-strong")}>
          <Avatar name={workspace.name} size={28} square />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-ink">{workspace.name}</span>
            <span className="block truncate text-[11px] text-ink-3">Workspace</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-ink-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Workspaces</MenuLabel>
          {workspaces.map((w) => (
            <MenuItem key={w.id} icon={<Avatar name={w.name} size={16} square />} hint={w.id === workspace.id ? <Check className="size-3.5 text-accent" /> : w.role} onClick={() => (close(), switchProjectAction(w.id))}>
              {w.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          {!isGuest && (
            <MenuItem href="/onboarding?new=1" onClick={close} icon={<Plus />}>
              New workspace
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  );
}

export function Sidebar(p: ShellProps & { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex h-full flex-col bg-surface-2/70">
      <div className="px-5 pb-2 pt-5">
        <Link href="/app" onClick={p.onNavigate} className="inline-flex" aria-label="Overview"><Logo grow /></Link>
      </div>
      <div className="px-3 py-4">
        <WorkspaceSwitcher workspace={p.workspace} workspaces={p.workspaces} isGuest={p.user.isGuest} />
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-1" aria-label="Main">
        {NAV.map((g, gi) => {
          // Only the most specific matching item is active (e.g. /app/kols/report, not also /app/kols).
          const activeHref = ALL_NAV.filter((n) => (n.href === "/app" ? path === "/app" : path === n.href || path.startsWith(`${n.href}/`))).sort((a, b) => b.href.length - a.href.length)[0]?.href;
          const items = g.items;
          if (!items.length) return null;
          return (
            <div key={gi}>
              {g.section && <div className="label mb-2 px-2.5">{g.section}</div>}
              <ul className="space-y-0.5">
                {items.map((it) => {
                  const active = it.href === activeHref;
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        aria-current={active ? "page" : undefined}
                        onClick={p.onNavigate}
                        className={cn("group relative flex h-9 items-center gap-2.5 rounded-[12px] px-2.5 text-[13.5px] transition-[background-color,color,transform,box-shadow] duration-200 active:scale-[0.98]", active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.06),0_2px_8px_-3px_rgb(10_11_12/0.14)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.07)]" : "text-ink-3 hover:translate-x-0.5 hover:bg-surface/70 hover:text-ink")}
                      >
                        <Icon className={cn("size-[16px] shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.3,1.6,0.5,1)] group-hover:-rotate-6 group-hover:scale-115", active ? "text-accent" : "text-ink-4 group-hover:text-ink-2")} strokeWidth={1.75} />
                        <span className="flex-1 truncate">{it.label}</span>
                        {active && <span className="size-1.5 rounded-full bg-accent" />}
                        {it.badge === "approvals" && p.pendingApprovals > 0 && <span className="num rounded-full bg-warning/15 px-1.5 text-[10.5px] font-medium text-warning ring-1 ring-warning/30">{p.pendingApprovals}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="space-y-2.5 p-3">
        {p.credit && (
          <Link
            href="/billing"
            onClick={p.onNavigate}
            title={p.credit.isOwner ? "Your prepaid balance — services are paid from it" : "The workspace owner's balance"}
            className={cn("group flex items-center justify-between gap-2 rounded-[14px] px-3 py-2.5 ring-1 transition-[transform,box-shadow] hover:-translate-y-px", p.credit.low ? "glow-butter ring-warning/30" : "glow-mint ring-line")}
          >
            <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
              <Coins className={cn("size-3.5", p.credit.low ? "text-warning" : "text-ink-3")} />
              Credit
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn("display text-[16px] leading-none", p.credit.low ? "text-warning" : "text-ink")}>{(p.credit.balanceMicro / 1e6).toFixed(2)}</span>
              {p.credit.isOwner && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium text-bg transition-transform group-hover:scale-105">Top up</span>}
            </span>
          </Link>
        )}
        <Link href="/app/wallet" onClick={p.onNavigate} className="flex items-center gap-2 px-1 text-[12px] text-ink-3 hover:text-ink">
          <StatusDot tone={p.wallet.state === "live" ? "good" : p.wallet.state === "frozen" ? "bad" : "warn"} pulse={p.wallet.state === "live"} />
          <span className="truncate">{p.wallet.label}</span>
        </Link>
        <Menu
          align="start"
          width={232}
          className="w-full"
          trigger={() => (
            <button className="flex w-full items-center gap-2 rounded-[12px] px-1.5 py-1.5 text-left transition-colors hover:bg-surface/70">
              <Avatar name={p.user.name} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-ink">{p.user.isGuest ? "Guest" : p.user.name}</span>
                <span className="block truncate text-[11px] text-ink-4">{p.role}</span>
              </span>
            </button>
          )}
        >
          <MenuLabel>{p.user.isGuest ? "Guest session" : p.user.email}</MenuLabel>
          {p.user.isGuest && (
            <MenuItem href="/signup" icon={<Plus />}>
              Create an account
            </MenuItem>
          )}
          <MenuItem icon={<LogOut />} onClick={() => logoutAction()}>
            Sign out
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
