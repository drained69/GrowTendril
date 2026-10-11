"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { reviewPostAction } from "@/server/actions/campaigns";
import { Button, Checkbox, Input, Select, cn } from "@/components/ui";
import { toast } from "@/components/ui/toast";

type Review = { relevance: number; depth: number; accuracy: number; disclosure: boolean; discussion: number; note: string };

const RUBRIC: { key: "relevance" | "depth" | "accuracy"; label: string; hint: string }[] = [
  { key: "relevance", label: "Relevance", hint: "On the campaign topic" },
  { key: "depth", label: "Depth", hint: "Useful beyond a mention" },
  { key: "accuracy", label: "Accuracy", hint: "Claims are correct" },
];

/** Rubric review for one submitted post. Accepting is blocked until the reviewer confirms disclosure. */
export function ReviewForm({ campaignId, postId, initial, disclosureText, disabled, className }: { campaignId: string; postId: string; initial?: Review | null; disclosureText: string; disabled?: boolean; className?: string }) {
  const [r, setR] = useState<Review>(initial ?? { relevance: 3, depth: 3, accuracy: 3, disclosure: false, discussion: 0, note: "" });
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"accept" | "reject" | null>(null);
  const router = useRouter();
  const score = Math.round(((r.relevance + r.depth + r.accuracy) / 15) * 100);
  const set = <K extends keyof Review>(k: K, v: Review[K]) => setR((cur) => ({ ...cur, [k]: v }));

  const submit = (accept: boolean) => {
    if (accept && !r.disclosure) return toast.error("Confirm the disclosure first", "A paid post can only be accepted when it clearly discloses the relationship.");
    setWhich(accept ? "accept" : "reject");
    start(async () => {
      const res = await reviewPostAction(campaignId, postId, accept, r);
      if (!res.ok) toast.error("Review not saved", res.error);
      else toast.success(res.message ?? "Review saved");
      router.refresh();
    });
  };

  return (
    <fieldset disabled={disabled || pending} className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {RUBRIC.map((x) => (
          <label key={x.key} className="block space-y-1">
            <span className="block text-[11.5px] font-medium text-ink-2" title={x.hint}>
              {x.label} <span className="font-normal text-ink-4">0–5</span>
            </span>
            <Select value={r[x.key]} onChange={(e) => set(x.key, Number(e.target.value))} className="num h-7 text-[12px]">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        ))}
        <label className="block space-y-1">
          <span className="block text-[11.5px] font-medium text-ink-2" title="Rated only when the post started useful discussion; pays a share of the discussion cap">
            Discussion <span className="font-normal text-ink-4">0–3</span>
          </span>
          <Select value={r.discussion} onChange={(e) => set("discussion", Number(e.target.value))} className="num h-7 text-[12px]">
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "0 — none" : n}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <Input value={r.note} onChange={(e) => set("note", e.target.value)} maxLength={500} placeholder="Note for the creator (shown on their contribution page)" className="h-7 text-[12px]" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          checked={r.disclosure}
          onChange={(e) => set("disclosure", e.target.checked)}
          label={
            <span>
              I checked the post: it clearly discloses the paid relationship (e.g. <span className="num">{disclosureText}</span>)
              <span className="ml-0.5 text-critical">*</span>
            </span>
          }
        />
        <div className="flex items-center gap-2">
          <span className="num text-[11.5px] text-ink-3">quality {score}/100</span>
          <Button type="button" size="xs" variant="danger" icon={<X />} loading={pending && which === "reject"} onClick={() => submit(false)}>
            Reject
          </Button>
          <Button type="button" size="xs" variant="primary" icon={<Check />} loading={pending && which === "accept"} disabled={!r.disclosure} onClick={() => submit(true)}>
            Accept
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
