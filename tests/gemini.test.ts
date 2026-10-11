import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { geminiStructured } from "@/server/integrations/llm/gemini";
import { aiName, aiProvider } from "@/server/integrations/llm";

const Schema = z.object({ fruit: z.string(), colours: z.array(z.string()).max(2), note: z.string().nullable() });
const ok = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });
const call = () => geminiStructured({ schema: Schema, system: "s", user: "u" });

describe("Gemini structured output", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "m-one,m-two");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends a JSON schema and returns validated data", async () => {
    fetchMock.mockResolvedValueOnce(ok({ fruit: "lime", colours: ["green"], note: null }));
    expect(await call()).toEqual({ data: { fruit: "lime", colours: ["green"], note: null } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/m-one:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const schema = JSON.parse(init.body).generationConfig.responseJsonSchema;
    expect(schema.$schema).toBeUndefined();
    expect(schema.properties.colours.maxItems).toBe(2);
  });

  it("falls back to the next model when one is overloaded", async () => {
    fetchMock.mockResolvedValueOnce(err(503, "high demand")).mockResolvedValueOnce(ok({ fruit: "fig", colours: [], note: "x" }));
    expect((await call()).data?.fruit).toBe("fig");
    expect(fetchMock.mock.calls[1][0]).toContain("/m-two:");
  });

  it("retries a dropped connection once on the same model", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok({ fruit: "kiwi", colours: [], note: null }));
    expect((await call()).data?.fruit).toBe("kiwi");
    expect(fetchMock.mock.calls[1][0]).toContain("/m-one:");
  });

  it("explains every model's failure when none answers", async () => {
    fetchMock.mockResolvedValueOnce(err(503, "high demand")).mockResolvedValueOnce(err(429, "quota"));
    const r = await call();
    expect(r.data).toBeNull();
    expect(r.error).toMatch(/m-one error 503.*m-two rate limited/);
  });

  it("stops at once on a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(err(403, "API key not valid"));
    expect((await call()).error).toMatch(/authentication failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects output that breaks the schema instead of passing it on", async () => {
    fetchMock.mockResolvedValueOnce(ok({ fruit: "plum", colours: ["a", "b", "c"], note: null }));
    expect(await call()).toEqual({ data: null, error: "Gemini output did not match the schema" });
  });
});

describe("AI provider choice", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers Gemini while its key is set, and Claude when forced", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    expect(aiProvider()).toBe("gemini");
    expect(aiName()).toBe("Gemini");
    vi.stubEnv("LLM_PROVIDER", "claude");
    expect(aiProvider()).toBe("claude");
  });

  it("is off when no key is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    expect(aiProvider()).toBeNull();
    expect(aiName()).toBe("AI");
  });
});
