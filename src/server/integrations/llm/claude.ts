import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Optional Claude layer. GrowTendril uses it for language tasks only (reading a product site,
 * drafting a brief). It never sets scores and never triggers payments. When no key is set,
 * or a call fails, every caller falls back to deterministic logic and says so.
 */

export const CLAUDE_MODEL = process.env.GROWTHOS_CLAUDE_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;

export function claudeEnabled(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export interface StructuredResult<T> {
  data: T | null;
  error?: string;
}

/** One structured-output call. Returns null data (with a reason) instead of throwing. */
export async function claudeStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  if (!claudeEnabled()) return { data: null, error: "Claude not configured (ANTHROPIC_API_KEY unset)" };
  try {
    const res = await getClient().beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") return { data: null, error: "Claude declined this request" };
    if (res.stop_reason === "max_tokens") return { data: null, error: "Claude response truncated" };
    if (res.parsed_output == null) return { data: null, error: "Claude output did not match the schema" };
    return { data: res.parsed_output as z.infer<S> };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { data: null, error: "Claude rate limited" };
    if (e instanceof Anthropic.AuthenticationError) return { data: null, error: "Claude authentication failed" };
    if (e instanceof Anthropic.APIError) return { data: null, error: `Claude API error ${e.status ?? ""}`.trim() };
    return { data: null, error: `Claude call failed: ${(e as Error).message}` };
  }
}
