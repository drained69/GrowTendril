"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, ChevronRight, Menu as MenuIcon, Search, X, Zap } from "lucide-react";
import { navLabel } from "@/components/layout/nav-config";
import { CommandPalette } from "@/components/layout/command-palette";
import { RunAgentButton } from "@/components/layout/run-agent-button";
import { Sidebar } from "@/components/layout/sidebar";
import type { Notice, ShellProps } from "@/lib/shell-types";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { Badge, ModeBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";


const AUTOPILOT: Record<string, string> = { off: "Autopilot off", hourly: "Autopilot · hourly", every_6h: "Autopilot · 6h", daily: "Autopilot · daily" };

export function Topbar({ shell, notices, canOperate }: { shell: ShellProps; notices: Notice[]; canOperate: boolean }) {
  const path = usePathname();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const section = navLabel(path);
  const detail = path.split("/").length > 3 && section && path !== "/app" ? "Details" : null;
  const demo = shell.workspace.dataMode === "DEMO";
  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md md:px-6">
        <button aria-label="Open navigation" className="text-ink-3 hover:text-ink md:hidden" onClick={() => setDrawer(true)}>
          <MenuIcon className="size-5" />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className="hidden truncate text-ink-3 sm:inline">{shell.workspace.name}</span>
          {demo && <ModeBadge mode="DEMO" className="hidden sm:inline-flex" />}
          {!shell.network.mainnet && !demo && (
            <span title={`Payments use test USDC on ${shell.network.name}`} className="hidden sm:inline-flex">
              <Badge tone="info">Testnet</Badge>
            </span>
          )}
          {section && (
            <>
              <ChevronRight className="hidden size-3.5 text-ink-4 sm:block" />
              <Link href={path.split("/").slice(0, 3).join("/")} className={cn("truncate", detail ? "text-ink-3 hover:text-ink" : "font-medium text-ink")}>
                {section}
              </Link>
            </>
          )}
          {detail && (
            <>
              <ChevronRight className="size-3.5 text-ink-4" />
              <span className="truncate font-medium text-ink">{detail}</span>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPalette(true)} className="hidden h-7 w-56 items-center gap-2 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] text-ink-4 transition-colors hover:border-ink-4 hover:text-ink-3 lg:flex">
            <Search className="size-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <Link href="/app/settings#autopilot" className={cn("hidden h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] sm:flex", shell.autopilot === "off" ? "text-ink-3 hover:bg-surface-2" : "bg-good/10 text-good hover:bg-good/15")} title="Operator schedule">
            <Zap className="size-3.5" />
            {AUTOPILOT[shell.autopilot] ?? "Autopilot"}
          </Link>
          <Menu
            width={320}
            trigger={() => (
              <button aria-label="Notifications" className="relative grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-surface-2 hover:text-ink">
                <Bell className="size-4" />
                {notices.length > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-warning ring-2 ring-bg" />}
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Needs attention</MenuLabel>
                {notices.length ? (
                  notices.map((n) => (
                    <MenuItem key={n.id} href={n.href} onClick={close} hint={<Badge tone={n.tone}>{n.tone === "bad" ? "failed" : n.tone === "warn" ? "action" : "info"}</Badge>}>
                      <span className="block truncate text-ink">{n.title}</span>
                      <span className="block truncate text-[11.5px] text-ink-3">{n.detail}</span>
                    </MenuItem>
                  ))
                ) : (
                  <div className="px-2 py-4 text-center text-[12px] text-ink-3">You’re all caught up.</div>
                )}
              </>
            )}
          </Menu>
          <RunAgentButton disabled={!canOperate} />
        </div>
      </header>
      <CommandPalette open={palette} onOpenChange={setPalette} demo={demo} />
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-64 animate-slide-up border-r border-line bg-surface">
            <button aria-label="Close navigation" className="absolute right-2 top-3 text-ink-3" onClick={() => setDrawer(false)}>
              <X className="size-5" />
            </button>
            <Sidebar {...shell} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  );
}
