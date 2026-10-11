import { Megaphone, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { Rule } from "@/components/features/campaigns/public-shell";
import { fmtUsdc } from "@/lib/money";

type RulesCampaign = {
  basePayMicro: number;
  maxPostsPerCreator: number;
  discussionBonusCapMicro: number;
  actionBonusMicro: number;
  creatorCapMicro: number;
  budgetMicro: number;
  maxCreators: number;
  disclosureText: string;
};

/** The exact earning rules, as enforced by the reward code. Shown to creators before they join and on their page. */
export function CampaignRules({ c, targetLabel, graceDays }: { c: RulesCampaign; targetLabel: string; graceDays: number }) {
  const action = targetLabel.toLowerCase();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="How you earn" icon={<Megaphone />} description="These are the exact rules. Every amount you earn is listed on your private page with its reason." />
        <CardBody className="divide-y divide-line">
          <Rule label="Per accepted post" value={fmtUsdc(c.basePayMicro)} hint={`Up to ${c.maxPostsPerCreator} paid post${c.maxPostsPerCreator === 1 ? "" : "s"}. A reviewer scores relevance, depth and accuracy (0–5 each) and checks the disclosure.`} />
          <Rule label="Useful-discussion bonus" value={`up to ${fmtUsdc(c.discussionBonusCapMicro)}`} hint="Per accepted post. A reviewer rates the discussion it started 0–3; each point earns a third of the cap." />
          <Rule label={`Per verified ${action}`} value={fmtUsdc(c.actionBonusMicro)} hint={`Once per unique person who arrives through your own tracking link and completes the ${action}, from launch until ${graceDays} days after the campaign window.`} />
          <Rule label="Your earnings ceiling" value={fmtUsdc(c.creatorCapMicro)} hint={`The most any one creator can earn. Rewards also stop if the ${fmtUsdc(c.budgetMicro)} campaign budget (up to ${c.maxCreators} creators) is used up.`} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Disclosure and honesty" icon={<ShieldCheck />} />
        <CardBody className="space-y-2.5 text-[12.5px] leading-relaxed text-ink-2">
          <p>
            <span className="font-medium text-ink">Paid posts must clearly disclose the relationship, e.g. #ad.</span> This campaign asks for <span className="num rounded-[4px] bg-surface-2 px-1 py-px text-ink ring-1 ring-line-strong">{c.disclosureText}</span> (or an equally clear statement) where people will see it — not hidden in a link or a pile of hashtags. Under FTC-style endorsement rules, audiences have a right to know when a creator is paid; a post without a clear disclosure can’t be accepted or paid.
          </p>
          <p>
            <span className="font-medium text-ink">Honest opinions are eligible — you are paid for accepted posts, not for positive sentiment.</span> Say what you actually think, including what didn’t work.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
