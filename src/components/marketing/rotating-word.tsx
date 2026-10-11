"use client";
import { useEffect, useState } from "react";

/** Cycles through words with a small drop-in, e.g. "Grow a coffee shop / a yoga studio / an app". */
export function RotatingWord({ words, ms = 2200, className }: { words: string[]; ms?: number; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % words.length), ms);
    return () => clearInterval(t);
  }, [words.length, ms]);
  return (
    <span className={className} aria-live="polite">
      <span key={i} className="inline-block" style={{ animation: "pop-in 380ms cubic-bezier(0.3,1.6,0.5,1) both" }}>
        {words[i]}
      </span>
    </span>
  );
}
