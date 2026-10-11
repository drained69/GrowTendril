"use client";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Loader2, Rocket } from "lucide-react";
import { createCampaignAction, previewPlanAction } from "@/server/actions/campaigns";
import type { CampaignPlan } from "@/server/domain/growth/campaign-plan";
import { fmtUsdc, toMicro } from "@/lib/money";
import { Button, Callout, Card, CardBody, CardFooter, CardHeader, Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { EconomicsHint } from "@/components/features/campaigns/economics-hint";
import { SourceBadge } from "@/components/features/campaigns/source-badge";

type Option = { value: string; label: string };
const USDC = /^\d{1,7}(\.\d{1,6})?$/;
const micro = (v: string) => (USDC.test(v.trim()) ? toMicro(v.trim()) : null);
const int = (v: string, d: number) => (/^\d+$/.test(v.trim()) ? Number(v) : d);

/** Create-campaign form: three inputs drive a live, explained plan; the server re-plans on submit. */
export function CampaignForm({ roomMicro, missionName, events, platforms, defaultDestination }: { roomMicro: number; missionName: string; events: Option[]; platforms: Option[]; defaultDestination: string }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(createCampaignAction, null);
  const [, startSubmit] = useTransition();
  const [target, setTarget] = useState(events.find((e) => e.value === "signup")?.value ?? events[0]?.value ?? "");
  const [maxCpa, setMaxCpa] = useState("");
  const [budget, setBudget] = useState("");
  const [days, setDays] = useState("14");
  const [posts, setPosts] = useState("2");
  const [creators, setCreators] = useState("");
  const [picked, setPicked] = useState<string[]>(["x"]);
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [planNote, setPlanNote] = useState<string | null>("Enter a max cost per action and a test budget to see the plan.");
  const [planning, startPlan] = useTransition();
  const seq = useRef(0);

  const targetLabel = events.find((e) => e.value === target)?.label ?? "action";
  const budgetMicro = micro(budget);
  const cpaMicro = micro(maxCpa);
  const overRoom = budgetMicro != null && budgetMicro > roomMicro;

  useEffect(() => {
    if (!cpaMicro || !budgetMicro) {
      setPlan(null);
      setPlanNote(maxCpa || budget ? "Amounts must look like 25 or 2.5 (USDC)." : "Enter a max cost per action and a test budget to see the plan.");
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      startPlan(async () => {
        const r = await previewPlanAction({
          budget: budget.trim(),
          maxCpa: maxCpa.trim(),
          days: Math.min(60, Math.max(3, int(days, 14))),
          postsPerCreator: Math.min(5, Math.max(1, int(posts, 2))),
          creators: creators.trim() ? Math.min(25, Math.max(1, int(creators, 1))) : undefined,
          actionLabel: targetLabel.toLowerCase(),
        });
        if (n !== seq.current) return;
        if (r.ok && r.data) {
          setPlan(r.data);
          setPlanNote(null);
        } else {
          setPlan(null);
          setPlanNote(r.ok ? "No plan returned." : r.error);
        }
      });
    }, 350);
    return () => clearTimeout(t);
  }, [budget, maxCpa, days, posts, creators, targetLabel, cpaMicro, budgetMicro]);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Campaign created");
      if (state.data?.id) router.push(`/app/campaigns/${state.data.id}`);
    } else toast.error("Couldn’t create the campaign", state.error);
  }, [state, router]);

  function submit(e: FormEvent<HTMLFormElement>) {
    // Dispatch manually so a server-side validation error doesn't wipe what was typed.
    e.preventDefault();
    if (!picked.length) {
      toast.error("Pick at least one platform");
      return;
    }
    const fd = new FormData(e.currentTarget);
    startSubmit(() => dispatch(fd));
  }

  return (
    <form onSubmit={submit} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="What you want to buy" description="The three numbers everything else is derived from." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Target action" htmlFor="cc-target" required hint="One tracked action per campaign. Visits are excluded — they’re cheap to fake.">
              <Select id="cc-target" name="targetEvent" value={target} onChange={(e) => setTarget(e.target.value)} className="h-10 text-[14px]">
                {events.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Max cost per ${targetLabel.toLowerCase()}`} htmlFor="cc-cpa" required hint="The most one verified action is worth to you.">
              <UsdcInput id="cc-cpa" name="maxCpa" value={maxCpa} onChange={setMaxCpa} placeholder="25" />
            </Field>
            <Field label="Test budget" htmlFor="cc-budget" required error={overRoom ? `Above the ${fmtUsdc(roomMicro)} unreserved in “${missionName}”` : null} hint={`Reserved from “${missionName}” — ${fmtUsdc(roomMicro)} unreserved.`}>
              <UsdcInput id="cc-budget" name="budget" value={budget} onChange={setBudget} placeholder="500" invalid={overRoom} />
            </Field>
          </CardBody>
        </Card>

        <EconomicsHint targetEvent={target} targetLabel={targetLabel} onUse={setMaxCpa} />

        <Card>
          <CardHeader title="Campaign details" description="What creators see on the public join page." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign name" htmlFor="cc-name" required>
              <Input id="cc-name" name="name" required minLength={3} maxLength={80} placeholder="Agent payments explainer" />
            </Field>
            <Field label="Topic" htmlFor="cc-topic" required hint="Used to measure observed mindshare.">
              <Input id="cc-topic" name="topic" required minLength={2} maxLength={60} placeholder="agent payments" />
            </Field>
            <Field label="Topic terms" htmlFor="cc-terms" hint="Comma-separated words that also count as on-topic (up to 12)." className="sm:col-span-2">
              <Input id="cc-terms" name="topicTerms" maxLength={300} placeholder="x402, nanopayments, usdc on arc" />
            </Field>
            <Field label="Brief" htmlFor="cc-brief" required hint="What useful content looks like. Honest opinions are eligible — say so." className="sm:col-span-2">
              <Textarea id="cc-brief" name="brief" required minLength={20} maxLength={2000} rows={4} placeholder="Show how you’d use the product for a real task. Share what worked and what didn’t." />
            </Field>
            <Field label="Destination" htmlFor="cc-dest" required hint="Each accepted creator gets their own tracking link that redirects here." className="sm:col-span-2">
              <Input id="cc-dest" name="destinationUrl" type="url" required pattern="https://.*" defaultValue={defaultDestination.startsWith("https://") ? defaultDestination : ""} placeholder="https://…" />
            </Field>
            <div className="space-y-1.5 sm:col-span-2">
              <div className="text-[12px] font-medium text-ink-2">
                Platforms<span className="ml-0.5 text-critical">*</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {platforms.map((p) => (
                  <Checkbox
                    key={p.value}
                    name="platforms"
                    value={p.value}
                    label={p.label}
                    checked={picked.includes(p.value)}
                    onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.value] : cur.filter((x) => x !== p.value)))}
                  />
                ))}
              </div>
              <p className="text-[11.5px] text-ink-3">Submitted posts must be links on the creator’s platform (any https site for blogs).</p>
            </div>
            <Field label="Disclosure text" htmlFor="cc-disc" required hint="Creators agree to include this or an equally clear disclosure in every paid post.">
              <Input id="cc-disc" name="disclosureText" required minLength={2} maxLength={40} defaultValue="#ad" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Days" htmlFor="cc-days" hint="3–60">
                <Input id="cc-days" name="days" type="number" min={3} max={60} required value={days} onChange={(e) => setDays(e.target.value)} className="num" />
              </Field>
              <Field label="Posts / creator" htmlFor="cc-posts" hint="1–5 paid">
                <Input id="cc-posts" name="postsPerCreator" type="number" min={1} max={5} required value={posts} onChange={(e) => setPosts(e.target.value)} className="num" />
              </Field>
              <Field label="Creators" htmlFor="cc-creators" hint="Blank = planned">
                <Input id="cc-creators" name="creators" type="number" min={1} max={25} value={creators} onChange={(e) => setCreators(e.target.value)} placeholder="auto" className="num" />
              </Field>
            </div>
          </CardBody>
          <CardFooter>
            <span>The campaign opens immediately and creates a running experiment under this mission.</span>
            <Button type="submit" variant="primary" icon={<Rocket />} loading={pending} disabled={!plan || overRoom || !picked.length}>
              Create campaign
            </Button>
          </CardFooter>
        </Card>
        {state && !state.ok && <Callout tone="danger" title="Couldn’t create the campaign">{state.error}</Callout>}
      </div>

      <PlanPanel plan={plan} note={planNote} planning={planning} cpaMicro={cpaMicro} budgetMicro={budgetMicro} targetLabel={targetLabel} />
    </form>
  );
}

function UsdcInput({ id, name, value, onChange, placeholder, invalid }: { id: string; name: string; value: string; onChange: (v: string) => void; placeholder: string; invalid?: boolean }) {
  return (
    <div className="relative">
      <Input id={id} name={name} inputMode="decimal" autoComplete="off" required value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-invalid={invalid} className={cn("num h-10 pr-14 text-[15px]", invalid && "border-critical")} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11.5px] text-ink-3">USDC</span>
    </div>
  );
}

function PlanPanel({ plan, note, planning, cpaMicro, budgetMicro, targetLabel }: { plan: CampaignPlan | null; note: string | null; planning: boolean; cpaMicro: number | null; budgetMicro: number | null; targetLabel: string }) {
  const action = targetLabel.toLowerCase();
  const rows: { k: string; v: string; sub?: string; bad?: boolean }[] = plan
    ? [
        { k: "Released at launch (test phase)", v: fmtUsdc(plan.testPhaseMicro), sub: `${Math.round(plan.rules.testPhaseShare * 100)}% of the budget` },
        { k: "Held for results", v: fmtUsdc(plan.heldForResultsMicro), sub: "released only to creators whose measured cost per action beats your ceiling" },
        { k: "Creators", v: String(plan.creators), sub: `${plan.days} days` },
        { k: "Test-phase ceiling per creator", v: fmtUsdc(plan.creatorCapMicro), sub: "raised later only by results" },
        { k: "Base pay per accepted post", v: fmtUsdc(plan.basePayMicro), sub: `up to ${plan.postsPerCreator} post${plan.postsPerCreator === 1 ? "" : "s"}` },
        { k: "Discussion bonus cap", v: fmtUsdc(plan.discussionBonusCapMicro), sub: "per post, reviewer-rated" },
        { k: `Bonus per verified ${action}`, v: fmtUsdc(plan.actionBonusMicro), sub: `payable after a ${plan.holdbackDays}-day holdback` },
        { k: "Action pool", v: fmtUsdc(plan.actionPoolMicro), sub: `≈ ${plan.actionsAtFullSpend} verified ${action}${plan.actionsAtFullSpend === 1 ? "" : "s"} at full spend` },
        { k: "Fixed pay at most", v: fmtUsdc(plan.fixedPoolMicro), sub: "every post accepted with max discussion" },
        {
          k: "Worst-case blended cost / action",
          v: plan.worstCaseCostPerActionMicro != null ? fmtUsdc(plan.worstCaseCostPerActionMicro) : "—",
          sub: plan.worstCaseCostPerActionMicro == null ? "no room left for actions" : cpaMicro && plan.worstCaseCostPerActionMicro > cpaMicro ? "above your ceiling" : "within your ceiling",
          bad: plan.worstCaseCostPerActionMicro == null || (!!cpaMicro && plan.worstCaseCostPerActionMicro > cpaMicro),
        },
      ]
    : [];
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader
        title="Plan"
        icon={<Calculator />}
        description="Derived from your three numbers and your project’s rules — each one comes with its reason."
        action={planning ? <Loader2 className="size-3.5 animate-spin text-ink-3" /> : plan ? <span className="flex items-center gap-1.5 text-[11px] text-ink-3">Rules <SourceBadge source={plan.rulesSource} /></span> : undefined}
      />
      {plan ? (
        <>
          <CardBody className="space-y-4">
            {budgetMicro != null && budgetMicro > 0 && (
              <div>
                <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[3px]">
                  <div className="h-full rounded-l-[3px] bg-s1 last:rounded-r-[3px]" style={{ width: `${Math.min(100, (plan.testPhaseMicro / budgetMicro) * 100)}%` }} title={`Test phase: ${fmtUsdc(plan.testPhaseMicro)}`} />
                  {plan.heldForResultsMicro > 0 && <div className="h-full flex-1 rounded-r-[3px] bg-surface-3 ring-1 ring-inset ring-line-strong" title={`Held for results: ${fmtUsdc(plan.heldForResultsMicro)}`} />}
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
                  <span>Test phase — released at launch</span>
                  <span>Held until results</span>
                </div>
              </div>
            )}
            <dl className="divide-y divide-line">
              {rows.map((r) => (
                <div key={r.k} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="min-w-0">
                    <span className="block text-[12px] text-ink-2">{r.k}</span>
                    {r.sub && <span className={cn("block text-[11px]", r.bad ? "text-warning" : "text-ink-4")}>{r.sub}</span>}
                  </dt>
                  <dd className={cn("num shrink-0 text-[13px]", r.bad ? "text-warning" : "text-ink")}>{r.v}</dd>
                </div>
              ))}
            </dl>
            {plan.warnings.length > 0 && (
              <Callout tone="warn" title={plan.warnings.length === 1 ? "One thing to check" : `${plan.warnings.length} things to check`}>
                <ul className="space-y-1">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Callout>
            )}
            <div>
              <div className="label mb-1.5">Why these numbers</div>
              <ol className="space-y-1.5 text-[12px] leading-snug text-ink-2">
                {plan.reasoning.map((r, i) => (
                  <li key={r} className="flex gap-2">
                    <span className="num shrink-0 text-ink-4">{i + 1}.</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            </div>
          </CardBody>
          <CardFooter>Ceilings, holdbacks and releases are enforced in code. Nothing unearned is ever paid.</CardFooter>
        </>
      ) : (
        <CardBody className="text-[12.5px] text-ink-3">{note}</CardBody>
      )}
    </Card>
  );
}
