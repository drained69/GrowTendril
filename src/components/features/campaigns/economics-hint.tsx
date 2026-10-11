"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { economicsForAction } from "@/server/actions/campaigns";
import type { CeilingSuggestion, Measured } from "@/server/domain/growth/economics";
import { fmtUsdc, microToDecimal } from "@/lib/money";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { SourceBadge } from "@/components/features/campaigns/source-badge";

/** What the project's own data says an action is worth — every input labelled with its source. */
export function EconomicsHint({ targetEvent, targetLabel, onUse }: { targetEvent: string; targetLabel: string; onUse: (usdc: string) => void }) {
  const [data, setData] = useState<{ measured: Measured; suggestion: CeilingSuggestion; saved: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    economicsForAction(targetEvent).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok && r.data) {
        setData(r.data);
        setError(null);
      } else setError(r.ok ? null : r.error);
    });
    return () => {
      live = false;
    };
  }, [targetEvent]);

  const s = data?.suggestion;
  return (
    <Card>
      <CardHeader
        title={`What a ${targetLabel.toLowerCase()} is worth to you`}
        description="Computed from your own events and Economics settings. Missing inputs stay missing — nothing is guessed."
        icon={<Scale />}
        action={loading ? <Loader2 className="size-3.5 animate-spin text-ink-3" /> : <Link href="/app/settings#economics" className="text-[12px] text-ink-3 hover:text-ink">Economics settings</Link>}
      />
      <CardBody className="space-y-3">
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
        {s && (
          <>
            <dl className="divide-y divide-line">
              {s.inputs.map((i) => (
                <div key={i.key} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                  <dt className="min-w-0">
                    <span className="block text-[12px] text-ink-2">{i.label}</span>
                    <span className="block text-[11px] leading-snug text-ink-4">{i.figure.detail}</span>
                  </dt>
                  <dd className="flex shrink-0 items-center gap-2">
                    <span className="num text-[13px] text-ink">{fmt(i.key, i.figure.value)}</span>
                    <SourceBadge source={i.figure.source} />
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-line bg-bg/50 px-3 py-2.5">
              <div className="min-w-0 text-[12px] leading-snug text-ink-2">{s.explanation}</div>
              {s.maxCostPerActionMicro != null && s.maxCostPerActionMicro > 0 && (
                <Button type="button" size="xs" variant="secondary" onClick={() => onUse(microToDecimal(s.maxCostPerActionMicro!))}>
                  Use {fmtUsdc(s.maxCostPerActionMicro)}
                </Button>
              )}
            </div>
            {data && data.measured.campaignCostPerAction.value != null && (
              <p className="text-[11.5px] text-ink-3">
                Past creator campaigns cost <span className="num text-ink-2">{fmtUsdc(data.measured.campaignCostPerAction.value)}</span> per verified {targetLabel.toLowerCase()} ({data.measured.campaignCostPerAction.detail}).
              </p>
            )}
            <p className="text-[11px] text-ink-4">
              Measured over the last {data?.measured.windowDays} days from {data?.measured.dataMode === "DEMO" ? "demo (fictional) events" : "live events"}: {data?.measured.actions} {targetLabel.toLowerCase()} events, {data?.measured.purchases} purchases.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function fmt(key: string, v: number | null): string {
  if (v == null) return "—";
  if (key === "value") return fmtUsdc(v);
  if (key === "rate") return `${(v * 100).toFixed(1)}%`;
  return `${Math.round(v * 100)}%`;
}
