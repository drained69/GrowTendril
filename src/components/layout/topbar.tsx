"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, ChevronRight, Keyboard, Menu as MenuIcon, Search, X, Zap } from "lucide-react";
import { LogoMark } from "@/components/layout/logo";
import { SERVICES } from "@/lib/services";
import { navMatch } from "@/components/layout/nav-config";
import { CommandPalette } from "@/components/layout/command-palette";
import { RunAgentButton } from "@/components/layout/run-agent-button";
import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme";
import { Shortcuts } from "@/components/layout/shortcuts";
import { RouteBar } from "@/components/layout/route-bar";
import type { Notice, ShellProps } from "@/lib/shell-types";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { useModal } from "@/components/ui/use-modal";


const AUTOPILOT: Record<string, string> = { off: "Autopilot off", hourly: "Autopilot · hourly", every_6h: "Autopilot · 6h", daily: "Autopilot · daily" };

export function Topbar({ shell, notices, canOperate }: { shell: ShellProps; notices: Notice[]; canOperate: boolean }) {
  const path = usePathname();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const drawerContainer = useModal(drawer, () => setDrawer(false));
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const match = navMatch(path);
  const section = match?.label ?? null;
  const detail = match && path !== match.href ? "Details" : null;
  return (
    <>
      <RouteBar />
      <header className={cn("sticky top-0 z-30 flex h-15 items-center gap-3 border-b px-4 backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200 md:px-8", scrolled ? "border-line bg-bg/80 shadow-[0_10px_30px_-22px_rgb(10_11_12/0.4)]" : "border-transparent bg-bg/50")}>
        <button type="button" aria-label="Open navigation" aria-expanded={drawer} aria-controls="mobile-navigation" className="text-ink-3 hover:text-ink md:hidden" onClick={() => setDrawer(true)}>
          <MenuIcon className="size-5" />
        </button>
        <Link href="/app" aria-label="Overview" className="md:hidden"><LogoMark size={24} className="text-accent" /></Link>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
          <span className="hidden truncate text-ink-3 sm:inline">{shell.workspace.name}</span>
          {section && (
            <>
              <ChevronRight className="hidden size-3.5 text-ink-4 sm:block" />
              <Link href={match?.href ?? "/app"} className={cn("truncate", detail ? "text-ink-3 hover:text-ink" : "font-medium text-ink")}>
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
          <button onClick={() => setPalette(true)} className="hidden h-8.5 w-60 items-center gap-2 rounded-full bg-surface px-3.5 text-[12.5px] text-ink-3 shadow-[0_0_0_1px_rgb(10_11_12/0.08)] transition-[box-shadow,color] hover:text-ink hover:shadow-[0_0_0_1px_rgb(10_11_12/0.16)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)] lg:flex">
            <Search className="size-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <Link href="/app/settings#autopilot" className={cn("hidden h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors sm:flex", shell.autopilot === "off" ? "text-ink-3 ring-1 ring-line hover:bg-surface-2" : "bg-mint text-good ring-1 ring-good/20 hover:bg-good/15")} title="Operator schedule">
            <Zap className="size-3.5" />
            {AUTOPILOT[shell.autopilot] ?? "Autopilot"}
          </Link>
          <button onClick={() => window.dispatchEvent(new Event("gt-shortcuts"))} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className="hidden size-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink sm:grid">
            <Keyboard className="size-4" />
          </button>
          <ThemeToggle />
          <Menu
            width={320}
            trigger={() => (
              <button aria-label="Notifications" className="relative grid size-8 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink">
                <Bell className="size-4" />
                {notices.length > 0 && <span className="live-halo absolute right-1 top-1 size-2 rounded-full bg-warning text-warning ring-2 ring-bg" />}
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
          <RunAgentButton disabled={!canOperate} priceUsdc={shell.credit ? SERVICES.scan.priceUsdc : undefined} creditLow={shell.credit?.low} ownsCredit={shell.credit?.isOwner} />
        </div>
      </header>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <Shortcuts />
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={() => setDrawer(false)} />
          <div id="mobile-navigation" ref={drawerContainer} role="dialog" aria-modal="true" aria-label="Navigation" tabIndex={-1} className="absolute inset-y-0 left-0 w-72 max-w-[calc(100vw-2rem)] animate-slide-up border-r border-line bg-bg">
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
