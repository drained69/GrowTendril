import { z } from "zod";
import { MAINNET_CHAINS, TESTNET_CHAINS } from "@/server/integrations/circle/config";

/**
 * Structured financial actions. Nothing that moves money accepts free-form text:
 * an LLM (or heuristic) must produce one of these shapes, and it is parsed with Zod
 * before the policy engine sees it.
 */

const usdcAmount = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, "USDC amount must be a decimal string with ≤ 6 decimals")
  .refine((s) => Number(s) > 0, "amount must be positive");

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed EVM address");

export const ReasonCode = z.enum([
  "VERIFY_CUSTOMER_INTENT",
  "ENRICH_COMPANY",
  "VERIFY_KOL_AUDIENCE",
  "MEASURE_NARRATIVE",
  "COMPETITOR_RESEARCH",
  "RUN_EXPERIMENT",
  "PAY_CREATOR",
  "PAY_BOUNTY",
  "PARTNER_INCENTIVE",
  "FUND_CAMPAIGN_CHAIN",
  "REALLOCATE_TO_WINNER",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const BudgetCategory = z.enum(["research", "services", "kol", "bounty", "content", "community", "treasury"]);
export type BudgetCategory = z.infer<typeof BudgetCategory>;

export const SupportedChain = z.enum([...TESTNET_CHAINS, ...MAINNET_CHAINS]);
export type SupportedChain = z.infer<typeof SupportedChain>;

const common = {
  currency: z.literal("USDC"),
  missionId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  expectedValue: z.enum(["low", "medium", "high"]),
};

export const PurchaseServiceAction = z.object({
  action: z.literal("purchase_service"),
  serviceId: z.string().min(1),
  resourceUrl: z.string().url(),
  amount: usdcAmount,
  reasonCode: ReasonCode,
  subject: z.object({ type: z.enum(["company", "kol", "narrative"]), id: z.string().min(1) }),
  chain: SupportedChain,
  ...common,
});

export const SendPaymentAction = z.object({
  action: z.literal("send_payment"),
  purpose: z.enum(["kol_payment", "developer_bounty", "partner_incentive", "campaign_payment"]),
  recipient: evmAddress,
  amount: usdcAmount,
  chain: SupportedChain,
  experimentId: z.string().min(1),
  reasonCode: ReasonCode,
  /** Distinguishes intentional repeat payments (e.g. a second tranche, a creator payout batch) from duplicates. */
  payoutRef: z.string().regex(/^[a-z0-9:_-]{1,64}$/).optional(),
  ...common,
});

export const BridgeFundsAction = z.object({
  action: z.literal("bridge_funds"),
  amount: usdcAmount,
  fromChain: SupportedChain,
  toChain: SupportedChain,
  reasonCode: z.literal("FUND_CAMPAIGN_CHAIN"),
  experimentId: z.string().min(1).optional(),
  ...common,
});

export const ReallocateBudgetAction = z.object({
  action: z.literal("reallocate_budget"),
  missionId: z.string().min(1),
  moves: z
    .array(
      z.object({
        fromExperimentId: z.string().min(1),
        toExperimentId: z.string().min(1),
        amount: usdcAmount,
        reason: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(10),
  confidence: z.number().min(0).max(1),
  reasonCode: z.literal("REALLOCATE_TO_WINNER"),
});

export const FinancialAction = z.discriminatedUnion("action", [
  PurchaseServiceAction,
  SendPaymentAction,
  BridgeFundsAction,
  ReallocateBudgetAction,
]);
export type FinancialAction = z.infer<typeof FinancialAction>;
export type PurchaseServiceAction = z.infer<typeof PurchaseServiceAction>;
export type SendPaymentAction = z.infer<typeof SendPaymentAction>;
export type BridgeFundsAction = z.infer<typeof BridgeFundsAction>;
export type ReallocateBudgetAction = z.infer<typeof ReallocateBudgetAction>;

/** Actions the policy can forbid outright even though GrowthOS never implements them. */
export const FORBIDDEN_ACTION_KINDS = ["mass_unsolicited_messaging", "automated_dm", "automated_cold_email", "automated_mentions"] as const;

export function categoryFor(action: FinancialAction): BudgetCategory {
  switch (action.action) {
    case "purchase_service":
      return action.reasonCode === "COMPETITOR_RESEARCH" || action.reasonCode === "MEASURE_NARRATIVE" ? "services" : "research";
    case "send_payment":
      return action.purpose === "kol_payment"
        ? "kol"
        : action.purpose === "developer_bounty"
          ? "bounty"
          : action.purpose === "partner_incentive"
            ? "community"
            : "content";
    case "bridge_funds":
      return "treasury";
    case "reallocate_budget":
      return "treasury";
  }
}

export function parseFinancialAction(input: unknown) {
  return FinancialAction.safeParse(input);
}
