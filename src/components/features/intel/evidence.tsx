import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge, ModeBadge } from "@/components/ui/badge";
import { relTime } from "@/lib/time";

export interface EvidenceRow {
  id: string;
  sourceUrl: string;
  sourceTitle?: string | null;
  excerpt: string;
  provider: string;
  signalType: string;
  observedAt: Date;
  classifiedBy: string;
  dataMode: string;
}

const PROVIDER_LABEL: Record<string, string> = { x: "X", bluesky: "Bluesky", github: "GitHub", reddit: "Reddit", youtube: "YouTube", hackernews: "Hacker News", rss: "News", x402: "Purchased data" };

/** One attributable piece of evidence: what was said, where, when, and how it was classified. */
export function EvidenceItem({ e }: { e: EvidenceRow }) {
  const external = e.sourceUrl.startsWith("http");
  return (
    <li className="group rounded-[8px] border border-line bg-bg/50 px-3 py-2.5 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
        <span className="font-medium text-ink-2">{PROVIDER_LABEL[e.provider] ?? e.provider}</span>
        <span className="text-ink-4">·</span>
        <span>{e.signalType.replace(/_/g, " ")}</span>
        <span className="text-ink-4">·</span>
        <time dateTime={e.observedAt.toISOString()} title={e.observedAt.toISOString()}>
          {relTime(e.observedAt)}
        </time>
        <span className="ml-auto flex items-center gap-1.5">
          {e.classifiedBy === "x402" && (
            <Badge tone="info">
              <ShieldCheck className="size-3" /> Paid · x402
            </Badge>
          )}
          <ModeBadge mode={e.dataMode} />
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{e.excerpt}</p>
      <a href={e.sourceUrl} target={external ? "_blank" : undefined} rel="noreferrer" className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[11.5px] text-s1 hover:underline">
        <span className="truncate">{e.sourceTitle ?? e.sourceUrl}</span>
        {external && <ArrowUpRight className="size-3 shrink-0" />}
      </a>
    </li>
  );
}

export function EvidenceList({ items, empty = "No evidence yet." }: { items: EvidenceRow[]; empty?: string }) {
  if (!items.length) return <p className="text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((e) => (
        <EvidenceItem key={e.id} e={e} />
      ))}
    </ul>
  );
}
