"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Splits "1,234.50" or "-12" into a number and the formatting needed to print it back. */
function parse(text: string) {
  const m = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const decimals = m[3]?.length ?? 0;
  return { value: Number(`${m[1]}${m[2].replace(/,/g, "")}${decimals ? `.${m[3]}` : ""}`), decimals, commas: m[2].includes(",") };
}

const fmt = (n: number, decimals: number, commas: boolean) => n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: commas });

/** Counts up to a numeric string the first time it scrolls into view. Server markup is the final value. */
export function CountUp({ text, duration = 900, className }: { text: string; duration?: number; className?: string }) {
  const parsed = parse(text);
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);

  useIso(() => {
    // Always land on the current value first, so a changed number is never left showing the old one.
    setShown(text);
    // A hidden tab never paints the animation, so it would sit at zero; just show the value.
    if (!parsed || parsed.value === 0 || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShown(fmt(0, parsed.decimals, parsed.commas));
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 4);
        setShown(p >= 1 ? text : fmt(parsed.value * eased, parsed.decimals, parsed.commas));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        io.disconnect();
        run();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      {shown}
    </span>
  );
}
