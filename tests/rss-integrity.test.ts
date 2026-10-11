import { afterEach, describe, expect, it, vi } from "vitest";
const wire = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/security/public-http", async (original) => ({ ...await original<typeof import("@/server/security/public-http")>(), getPublicText: wire.read }));
import { parseFeed, rss } from "@/server/integrations/providers/rss";
afterEach(() => { wire.read.mockReset(); });
const options = { since: new Date("2026-01-01"), limit: 10 };
const feed = (items: string) => `<rss><channel>${items}</channel></rss>`;
const item = (date: string, link: string) => `<item><title>Coffee news</title><link>${link}</link><pubDate>${date}</pubDate><description>Roasted coffee</description></item>`;

describe("RSS integrity", () => {
  it("chooses the Atom article link rather than the feed's self link", () => {
    const result = parseFeed(`<feed><entry><title>Coffee</title><link rel='self' href='https://example.com/feed'/><link href='https://example.com/article?a=1&amp;b=2' rel='alternate'/><updated>2026-05-01</updated></entry></feed>`);
    expect(result[0].link).toBe("https://example.com/article?a=1&b=2");
  });
  it("skips malformed dates/unsafe URLs and resolves relative article links", async () => {
    wire.read.mockResolvedValue({ ok: true, status: 200, url: "https://example.com/feed", text: feed(item("bad", "/bad") + item("2026-05-01", "javascript:alert(1)") + item("2026-05-01", "/article")) });
    expect((await rss.search("coffee", options, { feeds: "https://example.com/feed" })).map((post) => post.url)).toEqual(["https://example.com/article"]);
  });
  it("fails when every feed errors instead of counting failed reads as a successful empty scan", async () => {
    wire.read.mockResolvedValue({ ok: false, status: 404 });
    await expect(rss.search("coffee", options, { feeds: "https://example.com/missing" })).rejects.toThrow(/Couldn't read any/);
    wire.read.mockResolvedValue({ ok: true, status: 200, text: "<html>Login</html>" });
    await expect(rss.search("coffee", options, { feeds: "https://example.com/missing" })).rejects.toThrow(/did not return/);
  });
  it("keeps healthy feeds usable when another configured feed fails", async () => {
    wire.read.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ ok: true, status: 200, url: "https://example.com/feed", text: feed(item("2026-05-01", "/article")) });
    expect(await rss.search("coffee", options, { feeds: "https://bad.example/feed,https://example.com/feed" })).toHaveLength(1);
  });
});
