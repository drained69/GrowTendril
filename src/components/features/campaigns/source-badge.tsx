import { Badge, type Tone } from "@/components/ui/badge";

export type FigureSource = "measured" | "setting" | "starting" | "unavailable" | "input";

const SOURCE: Record<FigureSource, { tone: Tone; label: string; title: string }> = {
  measured: { tone: "good", label: "Measured", title: "Computed from this project's own events or ledger" },
  setting: { tone: "info", label: "Your setting", title: "Saved in Settings → Economics" },
  starting: { tone: "warn", label: "Starting value", title: "Not reviewed yet — set your own in Settings → Economics" },
  unavailable: { tone: "muted", label: "No data", title: "Not enough data and no setting — never filled with a guess" },
  input: { tone: "neutral", label: "Your input", title: "Entered for this campaign" },
};

/** Where a figure came from. Every budget number in campaigns carries one. */
export function SourceBadge({ source }: { source: FigureSource }) {
  const s = SOURCE[source];
  return (
    <span title={s.title}>
      <Badge tone={s.tone}>{s.label}</Badge>
    </span>
  );
}
