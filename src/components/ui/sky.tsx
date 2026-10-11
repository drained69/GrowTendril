import type { CSSProperties } from "react";
import { cn } from "@/components/ui/cn";

type Cloud = { left: string; top: string; w: number; h: number; drift?: number; dx?: number; o?: number };

/** Puffy CSS clouds; each is three soft ellipses that drift slowly side to side, lit warmer the nearer they sit to the horizon. */
const SETS: Record<"hero" | "bank" | "few", Cloud[]> = {
  hero: [
    { left: "-6%", top: "62%", w: 560, h: 230, drift: 70, dx: 50 },
    { left: "72%", top: "56%", w: 620, h: 260, drift: 85, dx: 60 },
    { left: "30%", top: "84%", w: 760, h: 240, drift: 95, dx: 40 },
    { left: "8%", top: "12%", w: 260, h: 90, drift: 60, dx: 70, o: 0.7 },
    { left: "78%", top: "18%", w: 220, h: 80, drift: 75, dx: 60, o: 0.6 },
  ],
  bank: [
    { left: "-10%", top: "55%", w: 460, h: 200, drift: 80, dx: 40 },
    { left: "60%", top: "62%", w: 520, h: 210, drift: 90, dx: 50 },
    { left: "20%", top: "80%", w: 620, h: 200, drift: 100, dx: 30 },
  ],
  few: [
    { left: "62%", top: "-18%", w: 340, h: 130, drift: 70, dx: 40, o: 0.85 },
    { left: "-8%", top: "48%", w: 300, h: 120, drift: 80, dx: 30, o: 0.7 },
  ],
};

export function Clouds({ set = "hero", className }: { set?: keyof typeof SETS; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10", className)}>
      {SETS[set].map((c, i) => (
        <div
          key={i}
          className="cloud"
          style={{ left: c.left, top: c.top, width: c.w, height: c.h, "--o": c.o, "--cloud": parseFloat(c.top) > 70 ? "#ffdcb4" : parseFloat(c.top) > 40 ? "#ffd8c8" : "#fbdcd6", "--drift": `${c.drift ?? 80}s`, "--drift-x": `${c.dx ?? 40}px`, animationDelay: `${-i * 13}s` } as CSSProperties}
        >
          <i />
        </div>
      ))}
    </div>
  );
}
