"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Plus, Sparkles } from "lucide-react";
import { NAV } from "@/components/layout/nav-config";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import type { ShellProps } from "@/lib/shell-types";
import { logoutAction, switchProjectAction, enterDemoAction } from "@/server/actions/auth";

export type { ShellProps };

function WorkspaceSwitcher({ workspace, workspaces, isGuest }: Pick<ShellProps, "workspace" | "workspaces"> & { isGuest: boolean }) {
  return (
    <Menu
      align="start"
      width={248}
      trigger={(open) => (
        <button className={cn("flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2", open && "bg-surface-2")}>
          <Avatar name={workspace.name} size={26} square />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink">{workspace.name}</span>
            <span className="block truncate text-[11px] text-ink-3">{workspace.dataMode === "DEMO" ? "Demo workspace" : "Workspace"}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-ink-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Workspaces</MenuLabel>
          {workspaces.map((w) => (
            <MenuItem key={w.id} icon={<Avatar name={w.name} size={16} square />} hint={w.id === workspace.id ? <Check className="size-3.5 text-s1" /> : w.dataMode === "DEMO" ? "demo" : w.role} onClick={() => (close(), switchProjectAction(w.id))}>
              {w.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          {!isGuest && (
            <MenuItem href="/onboarding?new=1" onClick={close} icon={<Plus />}>
              New workspace
            </MenuItem>
          )}
          {!workspaces.some((w) => w.dataMode === "DEMO") && (
            <MenuItem icon={<Sparkles />} onClick={() => (close(), enterDemoAction())}>
              Open a demo workspace
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  );
}

export function Sidebar(p: ShellProps & { onNavigate?: () => void }) {
  const path = usePathname();
  const demo = p.workspace.dataMode === "DEMO";
  return (
    <div className="flex h-full flex-col">
      <div className="p-2.5">
        <WorkspaceSwitcher workspace={p.workspace} workspaces={p.workspaces} isGuest={p.user.isGuest} />
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-4 pt-1" aria-label="Main">
        {NAV.map((g, gi) => {
          const items = g.items.filter((i) => !i.demoOnly || demo);
          if (!items.length) return null;
          return (
            <div key={gi}>
              {g.section && <div className="mb-1 px-2 text-[11px] font-medium text-ink-4">{g.section}</div>}
              <ul className="space-y-px">
                {items.map((it) => {
                  const active = it.href === "/app" ? path === "/app" : path.startsWith(it.href);
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        onClick={p.onNavigate}
                        className={cn("group flex h-7 items-center gap-2.5 rounded-[6px] px-2 text-[13px] transition-colors", active ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
                      >
                        <Icon className={cn("size-[15px] shrink-0", active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")} strokeWidth={1.75} />
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.badge === "approvals" && p.pendingApprovals > 0 && <span className="num rounded-[4px] bg-warning/15 px-1.5 text-[10.5px] font-medium text-warning">{p.pendingApprovals}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-line p-3">
        <Link href="/app/wallet" onClick={p.onNavigate} className="flex items-center gap-2 text-[11.5px] text-ink-3 hover:text-ink">
          <StatusDot tone={p.wallet.state === "live" ? "good" : p.wallet.state === "frozen" ? "bad" : "warn"} pulse={p.wallet.state === "live"} />
          <span className="truncate">{p.wallet.label}</span>
        </Link>
        <Menu
          align="start"
          width={232}
          className="w-full"
          trigger={() => (
            <button className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1 text-left hover:bg-surface-2">
              <Avatar name={p.user.name} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-ink">{p.user.isGuest ? "Guest" : p.user.name}</span>
                <span className="block truncate text-[11px] text-ink-4">{p.user.isGuest ? `Demo session${p.user.guestExpires ? ` · ${p.user.guestExpires}` : ""}` : p.role}</span>
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
