import { z } from "zod";
import type { StructuredResult } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Tried in order; the free tier often returns 503 "high demand" on one model while another answers. */
export function geminiModels(): string[] {
  const configured = process.env.GEMINI_MODEL?.split(",").map((m) => m.trim()).filter(Boolean);
  return configured?.length ? configured : ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"];
}

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY?.trim();

/** Gemini's responseJsonSchema accepts a JSON Schema subset; drop the keywords it rejects. */
function toGeminiSchema(schema: z.ZodType): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (k !== "$schema" && k !== "~standard") out[k] = strip(val);
    return out;
  };
  return strip(z.toJSONSchema(schema, { target: "draft-2020-12" }));
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function geminiStructured<S extends z.ZodType>(opts: { schema: S; system: string; user: string; maxTokens?: number }): Promise<StructuredResult<z.infer<S>>> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { data: null, error: "Gemini not configured (GEMINI_API_KEY unset)" };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: toGeminiSchema(opts.schema), maxOutputTokens: opts.maxTokens ?? 16000 },
  });

  const failures: string[] = [];
  for (const model of geminiModels()) {
    let res: Response | null = null;
    // A dropped connection gets one retry on the same model before moving to the next.
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        const timedOut = (e as Error).name === "TimeoutError";
        if (timedOut || attempt === 1) failures.push(`${model} ${timedOut ? "timed out" : `unreachable (${(e as Error).message})`}`);
        if (timedOut) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!res) continue;
    const json = (await res.json().catch(() => null)) as GeminiResponse | null;
    if (!res.ok) {
      const msg = json?.error?.message?.slice(0, 120) ?? res.statusText;
      if (res.status === 401 || res.status === 403) return { data: null, error: `Gemini authentication failed: ${msg}` };
      failures.push(res.status === 429 ? `${model} rate limited (free-tier quota)` : `${model} error ${res.status}: ${msg}`);
      if (RETRYABLE.has(res.status) || res.status === 404) continue;
      break;
    }
    const cand = json?.candidates?.[0];
    if (!cand) return { data: null, error: json?.promptFeedback?.blockReason ? `Gemini declined this request (${json.promptFeedback.blockReason})` : "Gemini returned no answer" };
    if (cand.finishReason === "MAX_TOKENS") return { data: null, error: "Gemini response truncated" };
    if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") return { data: null, error: "Gemini declined this request" };
    const text = cand.content?.parts?.filter((p) => !p.thought && p.text).map((p) => p.text).join("") ?? "";
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { data: null, error: "Gemini output was not valid JSON" };
    }
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) return { data: null, error: "Gemini output did not match the schema" };
    return { data: parsed.data };
  }
  return { data: null, error: `Gemini unavailable — ${failures.join("; ") || "no model answered"}` };
}

interface GeminiResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}
