import { ArrowUpRight, Lightbulb } from "lucide-react";
import type { opportunities } from "@/server/db/schema";
import { Badge, Confidence, LinkButton, ModeBadge, StatusBadge } from "@/components/ui";
import { fmtUsdc } from "@/lib/money";

type Opportunity = Pick<typeof opportunities.$inferSelect, "id" | "number" | "type" | "title" | "whyNow" | "recommendedAction" | "confidence" | "estimatedCostMicro" | "overallScore" | "status" | "dataMode">;
const LABEL: Record<string, string> = { CUSTOMER: "Customer outreach", PERSON: "Customer conversation", KOL: "Creator collaboration", NARRATIVE: "Market theme", PRODUCT_ISSUE: "Product improvement", CONTENT: "Content idea", COMMUNITY: "Community", PARTNERSHIP: "Partnership", COMPETITOR: "Competitive opportunity", EVENT: "Event" };

/** Reviewable recommendations from stored opportunities, never sample results. */
export function OpportunityCards({ items }: { items: Opportunity[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((o) => (
        <article key={o.id} className="flex min-w-0 flex-col rounded-[22px] border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={o.type === "PRODUCT_ISSUE" ? "warn" : "accent"}>{LABEL[o.type] ?? o.type.toLowerCase().replace(/_/g, " ")}</Badge>
            <span className="ml-auto"><ModeBadge mode={o.dataMode} /></span>
          </div>
          <h3 className="mt-4 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-ink">{o.title}</h3>
          <div className="mt-3 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3"><Lightbulb className="size-3.5" /> Why this is worth a look</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{o.whyNow[0] ?? "Review the source evidence before choosing a test."}</p>
            <details className="mt-3 rounded-[12px] border border-line bg-surface-2/40">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-ink-2">Proposed action</summary>
              <p className="px-3 pb-3 text-[12px] leading-relaxed text-ink-3">{o.recommendedAction}</p>
            </details>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
            <div><div className="text-[11px] text-ink-3">Estimated spend</div><div className="num mt-0.5 text-[14px] font-medium text-ink">{o.estimatedCostMicro > 0 ? fmtUsdc(o.estimatedCostMicro) : "Not estimated"}</div></div>
            <Confidence value={o.confidence} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-ink-3">Priority <span className="num">{o.overallScore}/100</span>{o.status !== "open" && <span className="ml-2"><StatusBadge status={o.status} /></span>}</span>
            <LinkButton href={`/app/opportunities/${encodeURIComponent(o.id)}`} icon={<ArrowUpRight />} variant="primary">{o.type === "PRODUCT_ISSUE" ? "Review issue" : "Review opportunity"}</LinkButton>
          </div>
        </article>
      ))}
    </div>
  );
}
