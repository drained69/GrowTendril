import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Dense data table. Cells pad 12px; header is sticky inside scroll containers. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("scroll-shadow-x overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13px] [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-3 [&_td]:align-middle [&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:border-b [&_th]:border-line [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2.5 [&_th]:font-mono [&_th]:text-[10.5px] [&_th]:font-normal [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-ink-4 [&_tr:last-child_td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-2/70 first:[&_td]:pl-5 first:[&_th]:pl-5 last:[&_td]:pr-5 last:[&_th]:pr-5">
        {children}
      </table>
    </div>
  );
}
