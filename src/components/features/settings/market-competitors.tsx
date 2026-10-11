"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import { saveMarketAction } from "@/server/actions/workspace";
import type { MarketLocation } from "@/server/domain/intel/location";
import type { CompetitorRecord } from "@/server/domain/intel/competitors";
import { Badge, Button, ExternalLink, Field, Input, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";

const SCOPE_LABEL = { local: "Local — one city or area", national: "National — the whole country", international: "International" } as const;

function place(l: MarketLocation | null): string {
  if (!l) return "Not detected yet";
  const p = [l.city, l.region, l.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  return p || (l.scope === "international" ? "International" : "Not detected");
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function MarketCompetitors({ location, competitors, countries, disabled }: { location: MarketLocation | null; competitors: CompetitorRecord[]; countries: { code: string; name: string }[]; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveMarketAction, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Market saved", state.message);
      router.refresh();
    } else toast.error("Couldn’t update the market", state.error);
  }, [state, router]);

  return (
    <div className="divide-y divide-line">
      <div className="space-y-2 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <MapPin className="size-4 text-ink-3" />
          <span className="text-[13px] font-medium text-ink">{place(location)}</span>
          {location && location.scope !== "unknown" && <Badge tone="muted">{location.scope}</Badge>}
          {location?.source === "founder" ? <Badge tone="info">set by you</Badge> : location?.countryCode ? <Badge tone={location.confidence === "high" ? "good" : location.confidence === "medium" ? "neutral" : "warn"}>detected · {location.confidence} confidence</Badge> : <Badge tone="warn">not detected</Badge>}
        </div>
        {location?.source === "detected" && location.evidence.length > 0 && <p className="text-[11.5px] text-ink-3">Evidence: {location.evidence.join(" · ")}</p>}
        {(!location?.countryCode || location.confidence === "low") && <p className="text-[11.5px] text-warning">Set your market below so competitors and search terms match where you actually sell.</p>}
        <form action={action} className="grid gap-3 pt-1 sm:grid-cols-[1.3fr_1fr_1fr_1.2fr_auto] sm:items-end">
          <fieldset disabled={disabled} className="contents">
            <Field label="Country" htmlFor="mk-country">
              <Select id="mk-country" name="country" defaultValue={location?.countryCode ?? ""} required>
                <option value="" disabled>
                  Choose…
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="State / region" htmlFor="mk-region">
              <Input id="mk-region" name="region" defaultValue={location?.region ?? ""} placeholder="Optional" maxLength={80} />
            </Field>
            <Field label="City" htmlFor="mk-city">
              <Input id="mk-city" name="city" defaultValue={location?.city ?? ""} placeholder="Optional" maxLength={80} />
            </Field>
            <Field label="Who you serve" htmlFor="mk-scope">
              <Select id="mk-scope" name="scope" defaultValue={location && location.scope !== "unknown" ? location.scope : "national"}>
                {Object.entries(SCOPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" size="md" icon={<Search />} loading={pending}>
              {pending ? "Searching…" : "Save & find competitors"}
            </Button>
          </fieldset>
        </form>
      </div>

      <div>
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <span className="label">Competitors in this market</span>
          <span className="text-[11px] text-ink-4">{competitors.length} shown · each one checked before it is listed</span>
        </div>
        {competitors.length === 0 ? (
          <p className="px-4 pb-3.5 text-[12px] text-ink-3">None verified yet. Set your market and search, or add names in the Competitors field below.</p>
        ) : (
          <ul className="divide-y divide-line">
            {competitors.map((c) => (
              <li key={`${c.name}-${c.website ?? ""}`} className="space-y-1 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{c.name}</span>
                  {c.website && (
                    <ExternalLink href={c.website} className="num text-[11.5px]">
                      {host(c.website)}
                    </ExternalLink>
                  )}
                  <Badge tone={c.source === "founder" ? "info" : "muted"}>{c.source === "web_search" ? "web search" : c.source === "site" ? "named on your site" : "added by you"}</Badge>
                  {c.locationCheck === "verified" && <Badge tone="good">in your market</Badge>}
                  {c.locationCheck === "search" && <Badge tone="neutral">market from search</Badge>}
                  {c.siteStatus === "blocks_readers" && <Badge tone="muted">site blocks automated readers</Badge>}
                </div>
                {c.reason && <p className="text-[12px] text-ink-2">{c.reason}</p>}
                {c.locationNote && <p className="text-[11.5px] text-ink-3">{c.locationNote}</p>}
                {c.evidenceUrls.length > 0 && (
                  <p className="text-[11px] text-ink-4">
                    Sources:{" "}
                    {c.evidenceUrls.map((u, i) => (
                      <span key={u}>
                        {i > 0 && " · "}
                        <ExternalLink href={u} className="text-ink-3">
                          {host(u)}
                        </ExternalLink>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
