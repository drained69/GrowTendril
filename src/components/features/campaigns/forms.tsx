"use client";
import { PasskeyWallet, type PasskeyConfig } from "@/components/features/campaigns/passkey-wallet";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";
import { createCampaignAction, inviteCreatorAction, acceptCreatorAction, submitCreatorPostAction, reviewCreatorPostAction } from "@/server/actions/creator-campaigns";
import type { ActionResult } from "@/server/actions/_common";
import { CAMPAIGN_GOALS, CAMPAIGN_PLATFORMS, MAX_CAMPAIGN_SLOTS, QUALITY_CRITERIA } from "@/lib/creator-campaigns";
import { EVENT_LABEL } from "@/server/domain/growth/attribution-links";

type FormAction = (previous: unknown, form: FormData) => Promise<ActionResult>;
function ActionForm({ action: server, children, label }: { action: FormAction; children: ReactNode; label: string }) {
  const [state, action, pending] = useActionState(server, null);
  const router = useRouter();
  useEffect(() => { if (!state) return; if (state.ok) {
    toast.success(state.message ?? "Saved"); const data = state.data as { url?: string } | undefined;
    if (data?.url) router.push(data.url); router.refresh();
  } }, [state, router]);
  const data = state?.ok ? state.data as { invite?: string } | undefined : undefined;
  return <form action={action} onSubmit={keepValues(action)} className="space-y-4">
    <fieldset disabled={pending} className="space-y-4">{children}<Button type="submit" variant="primary" loading={pending}>{label}</Button></fieldset>
    {state && !state.ok && <p role="alert" className="text-sm text-critical">{state.error}</p>}
    {data?.invite && <Field label="Private invite link" hint="Copy and share with this creator. Generating another link invalidates the previous invite."><Input readOnly aria-label="Private invite link" value={`${typeof window !== "undefined" ? window.location.origin : ""}${data.invite}`} onFocus={e => e.target.select()} /></Field>}
  </form>;
}
export function CampaignForm({ paymentCeilingUsdc }: { paymentCeilingUsdc: string }) {
  const [values, set] = useState({ cashLimit: 100, maxCpa: 10, target: 10, slots: 10, base: 4, qualityBonus: 3, outcomeBonus: 1, outcomeCap: 3 });
  const ceiling = Math.min(values.cashLimit, values.maxCpa * values.target);
  const perCreator = values.base + values.qualityBonus + values.outcomeBonus * values.outcomeCap;
  const reserved = values.slots * perCreator;
  const paymentCeiling = Number(paymentCeilingUsdc);
  const numeric = (key: keyof typeof values, label: string, step = "0.01", min = "0", max?: string) => <Field key={key} label={label} htmlFor={`cc-${key}`}><Input id={`cc-${key}`} name={key} type="number" min={min} max={max} step={step} value={values[key]} required onChange={e => set({ ...values, [key]: Number(e.target.value) })} /></Field>;
  return <ActionForm action={createCampaignAction} label="Create campaign & reserve rewards">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Campaign name" htmlFor="cc-title"><Input id="cc-title" name="title" required minLength={3} maxLength={100} placeholder="Introduce our API to builders" /></Field>
      <Field label="Topic to monitor" htmlFor="cc-topic" hint="Use a specific phrase; mindshare counts observed posts containing it."><Input id="cc-topic" name="topic" required minLength={3} maxLength={120} placeholder="wallet developer tools" /></Field>
      <Field label="Social source" htmlFor="cc-platform"><Select id="cc-platform" name="platform">{CAMPAIGN_PLATFORMS.map(p => <option key={p}>{p}</option>)}</Select></Field>
      <Field label="Qualified customer action" htmlFor="cc-goal"><Select id="cc-goal" name="goal">{CAMPAIGN_GOALS.map(p => <option key={p} value={p}>{EVENT_LABEL[p]}</option>)}</Select></Field>
      {numeric("target", "Target actions", "1", "1", "10000")}{numeric("maxCpa", "Maximum cost per action · USDC", "0.000001", "0.000001")}
      {numeric("cashLimit", "Maximum campaign budget · USDC", "0.000001", "0.000001")}{numeric("slots", "Creator slots", "1", "1", String(MAX_CAMPAIGN_SLOTS))}
    </div>
    <div className="rounded-2xl bg-surface-2 p-4 space-y-3">
      <p className="font-semibold text-sm">Published reward terms · one post per creator</p>
      <div className="grid gap-3 sm:grid-cols-2">{numeric("base", "Accepted post · USDC", "0.000001", "0.000001")}{numeric("qualityBonus", "Maximum quality bonus · USDC", "0.000001")}{numeric("outcomeBonus", "Per verified action · USDC", "0.000001")}{numeric("outcomeCap", "Rewarded actions per creator", "1", "0", "100")}</div>
      <p className="text-xs text-ink-3">Quality bonus = maximum bonus × reviewed score / 100. Four equally weighted criteria: relevance, originality, usefulness and substantive discussion. Each is scored 0–5; the first three need at least 3 for acceptance. Honest criticism is eligible.</p>
    </div>
    <Field label="Creator brief" htmlFor="cc-brief" hint="Describe the audience, the work, and evidence you expect. Terms are fixed once invitations open."><Textarea id="cc-brief" name="brief" rows={4} required minLength={30} maxLength={3000} placeholder="Try the product and share an original walkthrough for…" /></Field>
    <div aria-live="polite" className="rounded-2xl border border-line p-4 text-sm space-y-2">
      <p>Economic ceiling: <strong>{ceiling.toFixed(2)} USDC</strong> · lower of your campaign budget and target × maximum cost.</p>
      <p>Reward pool reserved: <strong>{reserved.toFixed(2)} USDC</strong> · up to {perCreator.toFixed(2)} per creator.</p>
      <p className="text-xs text-ink-3">Each creator&apos;s total reward must fit your workspace&apos;s {paymentCeilingUsdc} USDC per-payment ceiling. Change it in Settings → Spend policy before setting higher rewards.</p>
      <p className="text-xs text-ink-3">A 14-day campaign, followed by final review and payment approval. Reserved budget is a spending commitment; it is not escrow or a wallet deposit. Scans and reports use separate service credit. Results are targets, not guarantees.</p>
      {(reserved > ceiling || perCreator > paymentCeiling) && <p className="text-critical">Reduce rewards or slots: the pool must fit the campaign ceiling and each creator&apos;s total reward must fit your workspace&apos;s per-payment ceiling.</p>}
    </div>
  </ActionForm>;
}
export function InviteCreatorForm({ programId, creators }: { programId: string; creators: { id: string; handle: string }[] }) {
  return <ActionForm action={inviteCreatorAction.bind(null, programId)} label="Create private invite">
    <Field label="Creator" htmlFor="invite-kol"><Select id="invite-kol" name="kolId" required><option value="">Select a creator</option>{creators.map(c => <option key={c.id} value={c.id}>@{c.handle}</option>)}</Select></Field>
  </ActionForm>;
}
export function AcceptCreatorForm({ token, challenge, passkey, username }: { token: string; challenge: string; passkey?: PasskeyConfig; username?: string }) {
  const [address, setAddress] = useState(""), [proofId,setProofId] = useState("");
  return <ActionForm action={acceptCreatorAction.bind(null, token)} label="Accept campaign terms">
    <p className="text-sm text-ink-2">Publish <strong className="break-all">{challenge}</strong> on your social profile or in a public post. The business will check that it belongs to the invited account.</p>
    <Field label="Public ownership proof" htmlFor="proof"><Input id="proof" name="proof" type="url" required placeholder="https://…" /></Field>
    {passkey && username && <PasskeyWallet config={passkey} username={username} token={token} onVerified={(a,id)=>{setAddress(a);setProofId(id);}} />}
    {proofId && <input type="hidden" name="walletProof" value={proofId} />}
    <Field label="Your Arc USDC payout address" htmlFor="address"><Input id="address" name="address" value={address} onChange={e=>{setAddress(e.target.value);setProofId("");}} required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" /></Field>
    <Checkbox name="terms" required label="I accept these reward rules, the campaign dates, the one-post limit, and clear sponsorship disclosure. I control the account and payout address above." />
  </ActionForm>;
}
export function SubmitPostForm({ participantId }: { participantId: string }) {
  return <ActionForm action={submitCreatorPostAction.bind(null, participantId)} label="Submit my post">
    <Field label="Post link" htmlFor={`post-${participantId}`}><Input id={`post-${participantId}`} name="url" type="url" required placeholder="https://…" /></Field>
    <Field label="Published at · UTC" htmlFor={`date-${participantId}`} hint="Use the time shown on the source post, converted to UTC."><Input id={`date-${participantId}`} name="publishedAt" type="datetime-local" required step="1" /></Field>
    <Checkbox name="disclosure" required label="My original post clearly discloses that this campaign is sponsored." />
  </ActionForm>;
}
export function ReviewPostForm({ contributionId }: { contributionId: string }) {
  return <ActionForm action={reviewCreatorPostAction.bind(null, contributionId)} label="Save final review">
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(QUALITY_CRITERIA).map(([key, label]) => <Field key={key} label={label} htmlFor={`${contributionId}-${key}`}><Select id={`${contributionId}-${key}`} name={key} defaultValue="3">{[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n} / 5</option>)}</Select></Field>)}</div>
    <Field label="Decision" htmlFor={`decision-${contributionId}`}><Select id={`decision-${contributionId}`} name="decision"><option value="accepted">Accept</option><option value="rejected">Reject</option></Select></Field>
    <Field label="Evidence and reasons · visible to creator" htmlFor={`note-${contributionId}`}><Textarea id={`note-${contributionId}`} name="note" minLength={20} maxLength={1500} required rows={3} placeholder="Explain each score using examples from the post and its discussion." /></Field>
    <Checkbox name="checked" required label="I checked the author, publication date, original work and visible sponsorship disclosure against the source." />
  </ActionForm>;
}
