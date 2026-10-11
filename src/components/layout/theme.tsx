"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/menu";

type Pref = "light" | "dark" | "system";
const KEY = "gt-theme";

function resolve(pref: Pref) {
  return pref === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
}
function read(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

/** Runs before first paint inside /app so the page never flashes the wrong theme. */
export const THEME_BOOT = `try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

/** Keeps <html data-theme> in step with the saved choice, and clears it when leaving the app. */
export function ThemeSync() {
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.theme = resolve(read()));
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    window.addEventListener("gt-theme", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("gt-theme", apply);
      delete document.documentElement.dataset.theme;
    };
  }, []);
  return null;
}

export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>("system");
  useEffect(() => setPref(read()), []);
  const set = (p: Pref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {}
    window.dispatchEvent(new Event("gt-theme"));
  };
  const Icon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  return (
    <Menu
      width={168}
      trigger={() => (
        <button aria-label="Change theme" title="Theme" className="grid size-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
          <Icon className="size-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Monitor]] as const).map(([k, label, I]) => (
            <MenuItem key={k} icon={<I />} hint={pref === k ? "✓" : undefined} onClick={() => (set(k), close())}>
              {label}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
