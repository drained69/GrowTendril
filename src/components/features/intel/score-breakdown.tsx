import { ScoreBar } from "@/components/ui/meters";

export interface Component {
  key: string;
  label: string;
  weight?: number;
  score: number;
  reasons: string[];
}

/** Transparent score: every component, its weight, and the reasons behind it. */
export function ScoreBreakdown({ components, footnote }: { components: Component[]; footnote?: string }) {
  return (
    <div>
      <div className="space-y-3.5">
        {components.map((c) => (
          <div key={c.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-ink-2">{c.label}</span>
              {c.weight != null && c.weight > 0 && <span className="num text-[11px] text-ink-4">×{c.weight}</span>}
            </div>
            <ScoreBar value={c.score} />
            <ul className="mt-1 space-y-0.5 text-[11.5px] leading-snug text-ink-3">
              {c.reasons.map((r, ir) => (
                <li key={`${ir}:${r}`}>{r}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {footnote && <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-ink-3">{footnote}</p>}
    </div>
  );
}

export function WhyNow({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-[12.5px] text-ink-3">No dated signals yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((w, iw) => (
        <li key={`${iw}:${w}`} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-s1" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
