import { fmtUsdc } from "@/lib/money";
export function CampaignTerms({ program: p, experiment: e }: { program: { brief: string; baseMicro: number; qualityBonusMicro: number; outcomeBonusMicro: number; outcomeCap: number }; experiment: { startsAt: Date | null; endsAt: Date | null; successEvent: string } }) {
  return <div className="space-y-3 text-sm text-ink-2">
    <p className="whitespace-pre-wrap">{p.brief}</p>
    <div className="rounded-xl bg-surface-2 p-4 space-y-2">
      <p><strong>{fmtUsdc(p.baseMicro)}</strong> for one accepted original post, plus up to <strong>{fmtUsdc(p.qualityBonusMicro)}</strong> for quality.</p>
      <p><strong>{fmtUsdc(p.outcomeBonusMicro)}</strong> per verified {e.successEvent.replace(/_/g," ")} · at most {p.outcomeCap} rewarded actions per creator.</p>
      <p>Quality is scored 0–5 each for relevance, originality, usefulness and substantive discussion. Relevance, originality and usefulness each need 3/5 for acceptance. The quality bonus is proportional to the total score.</p>
      <p>Honest opinions, including criticism, are eligible. Sponsorship must be clearly disclosed. Copied posts, artificial engagement and unsupported claims are ineligible.</p>
      <p>Campaign: {e.startsAt?.toLocaleDateString("en-GB", { timeZone: "UTC" })}–{e.endsAt?.toLocaleDateString("en-GB", { timeZone: "UTC" })}. Ends {e.endsAt?.toISOString().slice(11,16)} UTC. Final review opens after the deadline; the business approves each payment.</p>
      <p className="text-xs text-ink-3">Outcome bonuses count distinct customer identifiers from signed product events received during the campaign, after your post was published. The earliest qualifying referral wins within this campaign. Manual entries and visits do not earn bonuses. Mindshare is informational and does not change your reward.</p>
    </div>
  </div>;
}
