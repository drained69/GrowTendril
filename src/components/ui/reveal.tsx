"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" | "span" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A hidden tab (or a thumbnail capture) never reports intersections, so show the content straight away.
    if (typeof IntersectionObserver === "undefined" || document.hidden) return void el.classList.add("is-visible");
    el.classList.add("can-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          el.classList.add("is-visible");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => { io.disconnect(); el.classList.remove("can-reveal"); };
  }, []);
  const Component = Tag as "div";
  return (
    <Component ref={ref as never} className={cn("reveal", className)} style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}>
      {children}
    </Component>
  );
}
