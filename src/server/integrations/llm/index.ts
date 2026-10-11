import type { z } from "zod";
import { claudeEnabled, claudeStructured } from "./claude";
import { geminiEnabled, geminiStructured } from "./gemini";
import type { StructuredResult } from "./types";

/**
 * The optional AI layer. It only handles language tasks (reading a product site, writing prose);
 * it never sets scores or triggers payments, and every caller falls back to deterministic logic.
 * Gemini is used while GEMINI_API_KEY is set, Claude otherwise; LLM_PROVIDER forces one.
 */
export type AiProvider = "gemini" | "claude";

export function aiProvider(): AiProvider | null {
  const forced = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (forced === "claude") return claudeEnabled() ? "claude" : null;
  if (forced === "gemini") return geminiEnabled() ? "gemini" : null;
  if (geminiEnabled()) return "gemini";
  if (claudeEnabled()) return "claude";
  return null;
}

export const aiEnabled = () => aiProvider() !== null;

export function aiName(): string {
  const p = aiProvider();
  return p === "gemini" ? "Gemini" : p === "claude" ? "Claude" : "AI";
}

export async function aiStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  const p = aiProvider();
  if (p === "gemini") return geminiStructured(opts);
  if (p === "claude") return claudeStructured(opts);
  return { data: null, error: "AI not configured (set GEMINI_API_KEY or ANTHROPIC_API_KEY)" };
}
