"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** A hairline that sweeps across the top whenever the page changes. */
export function RouteBar() {
  const path = usePathname();
  const [tick, setTick] = useState<string | null>(null);
  useEffect(() => {
    setTick(path);
    const t = setTimeout(() => setTick(null), 800);
    return () => clearTimeout(t);
  }, [path]);
  if (!tick) return null;
  return <div key={tick} aria-hidden className="route-bar" style={{ animation: "bar-grow 650ms cubic-bezier(0.2,0.8,0.2,1) both, fade-out 300ms ease 500ms forwards" }} />;
}
