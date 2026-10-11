"use server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";
import { createCreatorCampaign, inviteCreator, acceptCreatorInvite, verifyParticipant, submitContribution, reviewContribution, proposeCreatorReward } from "@/server/domain/growth/creator-campaigns";

const refresh = () => { revalidatePath("/app", "layout"); revalidatePath("/creator", "layout"); };
async function creator() {
  const user = await currentUser();
  if (!user?.emailVerified) throw new Error("Sign in and verify your email first");
  await limited(`creator:${user.id}`, 20, 0.2);
  return { user, db: await getDb() };
}
export async function createCampaignAction(_: unknown, form: FormData): Promise<ActionResult<{ url: string }>> {
  try { const { db, project, user } = await guard("manage_policy");
    const id = await createCreatorCampaign(db, project.id, user.id, Object.fromEntries(form)); refresh();
    return { ok: true, data: { url: `/app/campaigns/${id}` }, message: "Campaign created and reward pool reserved" };
  } catch (e) { return fail(e); }
}
export async function inviteCreatorAction(programId: string, _: unknown, form: FormData): Promise<ActionResult<{ invite: string }>> {
  try { const { db, project, user } = await guard("operate");
    const token = await inviteCreator(db, project.id, user.id, programId, String(form.get("kolId") ?? "")); refresh();
    return { ok: true, data: { invite: `/creator/invite/${token}` }, message: "Private invite created. Share it with this creator." };
  } catch (e) { return fail(e); }
}
export async function acceptCreatorAction(token: string, _: unknown, form: FormData): Promise<ActionResult<{ url: string }>> {
  try { const { user, db } = await creator();
    if (form.get("terms") !== "on") throw new Error("Accept the published campaign terms");
    await acceptCreatorInvite(db, user.id, token, String(form.get("address") ?? ""), String(form.get("proof") ?? "")); refresh();
    return { ok: true, data: { url: "/creator" }, message: "Joined. The business will review your ownership proof." };
  } catch (e) { return fail(e); }
}
export async function verifyCreatorAction(participantId: string): Promise<ActionResult> {
  try { const { db, project, user } = await guard("approve"); await verifyParticipant(db, project.id, user.id, participantId); refresh(); return { ok: true, message: "Creator ownership verified" }; }
  catch (e) { return fail(e); }
}
export async function submitCreatorPostAction(participantId: string, _: unknown, form: FormData): Promise<ActionResult> {
  try { const { user, db } = await creator();
    if (form.get("disclosure") !== "on") throw new Error("Confirm that your post clearly discloses the sponsorship");
    await submitContribution(db, user.id, participantId, String(form.get("url") ?? ""), new Date(`${String(form.get("publishedAt") ?? "")}Z`)); refresh();
    return { ok: true, message: "Post submitted for final review after the campaign ends" };
  } catch (e) { return fail(e); }
}
export async function reviewCreatorPostAction(contributionId: string, _: unknown, form: FormData): Promise<ActionResult> {
  try { const { db, project, user } = await guard("approve");
    if (form.get("checked") !== "on") throw new Error("Confirm the post author, date, originality and sponsorship disclosure");
    await reviewContribution(db, project.id, user.id, contributionId, Object.fromEntries(form)); refresh(); return { ok: true, message: "Final review recorded with its reward calculation" };
  } catch (e) { return fail(e); }
}
export async function proposeCreatorRewardAction(contributionId: string): Promise<ActionResult> {
  try { const { db, project } = await guard("operate"); const result = await proposeCreatorReward(db, project.id, contributionId); refresh();
    if (result.verdict === "DENY") return { ok: false, error: result.message };
    return { ok: true, message: result.message };
  } catch (e) { return fail(e); }
}

export async function closeCreatorCampaignAction(programId: string): Promise<ActionResult> {
  try { const { db, project, user } = await guard("manage_policy");
    const { closeCreatorCampaign } = await import("@/server/domain/growth/creator-campaigns");
    await closeCreatorCampaign(db, project.id, user.id, programId); refresh(); return { ok: true, message: "Campaign closed; unused rewards released to the mission" };
  } catch (e) { return fail(e); }
}
