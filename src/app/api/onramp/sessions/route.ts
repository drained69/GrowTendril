import { createOnrampServerKit, createSessionRouteHandler } from "@circle-fin/onramp-kit/server";
import { currentProject, currentUser } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { IS_MAINNET } from "@/server/integrations/circle/config";
import { getWallet } from "@/server/integrations/circle/wallets";

export const dynamic = "force-dynamic";

/** onramp-kit's chain id for Arc (its Blockchain enum); without it the widget defaults to Ethereum. */
const ONRAMP_CHAIN = "Arc";
/** Asset-selector scoping (display only): USDC on Arc. */
const ONRAMP_ASSETS = { pairs: [{ token: "USDC", chain: "arc" }] };

/** Hostname the widget is embedded on (frame-ancestor allowlist) — from trusted config, never the request. */
function referrerDomain(): string | undefined {
  const explicit = process.env.ONRAMP_REFERRER_DOMAIN?.trim();
  if (explicit) return explicit;
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).hostname : undefined;
  } catch {
    return undefined;
  }
}

const deny = (status: number, error: string) => Response.json({ error }, { status });

/**
 * Arc Onramp session minting. Only a wallet manager of the current workspace, only to that workspace's
 * own wallet, only USDC on Arc. The session request is rebuilt server-side: nothing from the client body
 * except the address (which must match) reaches Circle.
 */
export async function POST(req: Request) {
  if (!process.env.ONRAMP_API_KEY) return deny(501, "Onramp not configured (ONRAMP_API_KEY)");
  // The widget only has a production environment: it delivers mainnet USDC.
  if (!IS_MAINNET) return deny(409, "Arc Onramp delivers mainnet USDC — this deployment runs on testnet");
  const user = await currentUser();
  if (!user) return deny(401, "Signed out");
  const cur = await currentProject(user.id);
  if (!cur) return deny(403, "No workspace selected");
  if (!can(cur.role, "manage_wallet")) return deny(403, `Your role (${cur.role}) cannot fund the wallet`);
  if (cur.project.dataMode === "DEMO") return deny(403, "Demo workspaces run in simulation");
  const db = await getDb();
  const wallet = await getWallet(db, cur.project.id);
  if (!wallet?.address) return deny(409, "Create the workspace wallet first");
  const body = (await req.json().catch(() => null)) as { destinationAddress?: unknown } | null;
  if (typeof body?.destinationAddress !== "string" || body.destinationAddress.toLowerCase() !== wallet.address.toLowerCase()) return deny(400, "Onramp can only fund this workspace's wallet");

  const session = { appUserId: user.id, destinationAddress: wallet.address, destinationChain: ONRAMP_CHAIN, assets: ONRAMP_ASSETS };
  await audit(db, { projectId: cur.project.id, actorType: "user", actorId: user.id, action: "wallet.onramp_session", target: wallet.address });
  const handler = createSessionRouteHandler(createOnrampServerKit({ apiKey: process.env.ONRAMP_API_KEY, referrerDomain: referrerDomain() }), { authorize: () => true });
  return handler(new Request(req.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(session) }));
}
