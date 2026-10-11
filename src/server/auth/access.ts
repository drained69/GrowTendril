/**
 * Workspace roles and what each may do. Enforced server-side in every action and page;
 * the UI only hides controls the role cannot use.
 */
export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "view"
  | "operate" // run cycles, buy data within policy, create/launch experiments
  | "approve" // resolve Approval Inbox items
  | "manage_policy"
  | "manage_wallet"
  | "manage_integrations"
  | "manage_members"
  | "manage_workspace";

const GRANTS: Record<Role, Permission[]> = {
  viewer: ["view"],
  member: ["view", "operate"],
  admin: ["view", "operate", "approve", "manage_policy", "manage_wallet", "manage_integrations", "manage_members"],
  owner: ["view", "operate", "approve", "manage_policy", "manage_wallet", "manage_integrations", "manage_members", "manage_workspace"],
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including deleting the workspace and granting the owner role to others.",
  admin: "Approves spend, edits policy, manages the wallet, integrations and members.",
  member: "Runs the agent and experiments within policy. Cannot approve spend.",
  viewer: "Read-only access to intelligence, experiments and receipts.",
};

export function can(role: Role | string | null | undefined, p: Permission): boolean {
  return !!role && (GRANTS[role as Role] ?? []).includes(p);
}

export function isRole(r: string): r is Role {
  return (ROLES as readonly string[]).includes(r);
}
