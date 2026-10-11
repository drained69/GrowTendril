import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return <section id={id} className={cn("scroll-mt-20 border-t border-line py-24 sm:py-32", className)}>{children}</section>;
}

/** The green lead-in that sits above every headline: "Measured, not claimed ›". */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("eyebrow", className)}>{children}</div>;
}

/** Section headline in the hand-drawn face; it wobbles a little when you hover it. */
export function Headline({ children, className, center }: { children: ReactNode; className?: string; center?: boolean }) {
  return <h2 className={cn("display display-bounce mt-4 text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.1] text-ink", center && "mx-auto text-center", className)}>{children}</h2>;
}

export function Lede({ children, className, center }: { children: ReactNode; className?: string; center?: boolean }) {
  return <p className={cn("mt-5 max-w-[620px] text-[17px] leading-[1.65] text-ink/60", center && "mx-auto text-center", className)}>{children}</p>;
}
