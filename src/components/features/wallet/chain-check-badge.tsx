import { Badge } from "@/components/ui";

const CHECK: Record<string, { tone: "good" | "bad" | "warn"; label: string; title: string }> = {
  verified: { tone: "good", label: "Arc ✓", title: "Read back from Arc: the approved amount reached the approved address" },
  mismatch: { tone: "bad", label: "Arc mismatch", title: "Arc shows something different from what was approved — see Wallet → Records vs. Arc" },
  unverified: { tone: "warn", label: "Not checked", title: "This payment couldn't be read back from Arc — see Wallet → Records vs. Arc" },
};

/** The result of reading a payment back from Arc after it was sent. Nothing for payments not checked yet. */
export function ChainCheckBadge({ check }: { check: string | null }) {
  const c = check ? CHECK[check] : null;
  if (!c) return null;
  return (
    <span title={c.title}>
      <Badge tone={c.tone}>{c.label}</Badge>
    </span>
  );
}
