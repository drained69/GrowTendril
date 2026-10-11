import { Flag, Lock } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { activeMission } from "@/server/queries/missions";
import { missionRoom } from "@/server/domain/growth/creator-campaigns";
import { CONVERSION_EVENTS, EVENT_LABEL } from "@/server/domain/growth/attribution-links";
import { PLATFORMS, PLATFORM_LABEL } from "@/server/domain/growth/campaign-plan";
import { fmtUsdc } from "@/lib/money";
import { EmptyState, LinkButton, ModeBadge, PageHeader } from "@/components/ui";
import { CampaignForm } from "@/components/features/campaigns/campaign-form";

export const metadata = { title: "New creator campaign" };

export default async function NewCampaign() {
  const { project, role, db } = await requireProject();
  const mission = await activeMission(db, project.id);
  const room = mission ? await missionRoom(db, mission) : 0;
  const crumbs = [{ label: "Creator campaigns", href: "/app/campaigns" }];

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={crumbs}
        title="New creator campaign"
        description="Tell GrowthOS the action you want, what one is worth to you, and how much you’ll put behind the test. It plans the rest and shows its reasoning."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            {mission && (
              <span>
                Mission: {mission.name} · <span className="num text-ink-2">{fmtUsdc(room)}</span> unreserved
              </span>
            )}
          </>
        }
      />
      {!can(role, "operate") ? (
        <EmptyState icon={<Lock />} title="Your role can’t start campaigns" description="Creating a campaign reserves mission budget, so it needs the operator role or above." action={<LinkButton href="/app/campaigns">Back to campaigns</LinkButton>} />
      ) : !mission ? (
        <EmptyState
          icon={<Flag />}
          title="Create a mission first"
          description="Campaign budgets are reserved from the active mission, so the test can never spend more than the mission allows."
          action={
            <LinkButton href="/app/missions" variant="primary">
              Set up a mission
            </LinkButton>
          }
        />
      ) : (
        <CampaignForm
          roomMicro={room}
          missionName={mission.name}
          events={CONVERSION_EVENTS.filter((e) => e !== "visit").map((e) => ({ value: e, label: EVENT_LABEL[e] }))}
          platforms={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))}
          defaultDestination={project.website ?? ""}
        />
      )}
    </div>
  );
}
