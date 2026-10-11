import { stripHtml, USER_AGENT } from "@/server/integrations/providers/http";
import { ProviderError, type Credentials, type FetchedPost, type MarketProvider } from "@/server/integrations/providers/types";
import { assertPublicUrl, safeFetch } from "@/server/security/safe-fetch";
import { termHits } from "@/server/domain/intel/signals";
import { sha256 } from "@/server/lib/ids";

/** News/blogs via RSS/Atom feeds the founder configures (RSS_FEEDS, comma-separated). */
const MAX_FEEDS = 20;
const feedList = (c: Credentials) => (c.feeds ?? "").split(",").map((x) => x.trim()).filter(Boolean);
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : undefined;
}

export function parseFeed(xml: string): { title: string; link: string; date: Date; author: string; body: string }[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    return {
      title: stripHtml(tag(b, "title") ?? ""),
      link: (tag(b, "link") || atomLink || "").trim(),
      date: new Date(tag(b, "pubDate") ?? tag(b, "updated") ?? tag(b, "published") ?? Date.now()),
      author: stripHtml(tag(b, "dc:creator") ?? tag(b, "author") ?? "unknown").slice(0, 80),
      body: stripHtml(tag(b, "description") ?? tag(b, "content") ?? tag(b, "summary") ?? "").slice(0, 3000),
    };
  });
}

export const rss: MarketProvider = {
  id: "rss",
  name: "News & blogs (RSS)",
  description: "News and blog posts from RSS/Atom feeds you choose, filtered to your search terms.",
  category: "news",
  docsUrl: "https://www.rssboard.org/rss-specification",
  access: "public_api",
  credentialFields: [{ key: "feeds", label: "Feed URLs", secret: false, placeholder: "https://blog.example.com/feed.xml, …", help: "Comma-separated RSS or Atom feed URLs." }],
  envFallback: { feeds: "RSS_FEEDS" },
  isReady: (c) => feedList(c).length > 0,
  // Feed URLs are workspace-supplied and fetched server-side: public http(s) hosts only.
  async validate(creds) {
    const feeds = feedList(creds);
    if (feeds.length > MAX_FEEDS) throw new Error(`At most ${MAX_FEEDS} feeds`);
    for (const f of feeds) {
      try {
        await assertPublicUrl(f);
      } catch (e) {
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    }
  },
  async search(query, { since, limit, warnings }, creds) {
    const feeds = feedList(creds).slice(0, MAX_FEEDS);
    const terms = query.split(/\s+OR\s+/i).map((t) => t.replace(/"/g, "").trim());
    const out: FetchedPost[] = [];
    const failed: string[] = [];
    for (const feed of feeds) {
      let body: string;
      try {
        const res = await safeFetch(feed, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, timeoutMs: 10_000, maxBytes: 3_000_000 });
        if (!res.ok) {
          failed.push(`${feed}: HTTP ${res.status}`);
          continue;
        }
        body = res.body;
      } catch (e) {
        failed.push(`${feed}: ${(e as Error).message}`);
        continue;
      }
      const host = new URL(feed).host;
      for (const it of parseFeed(body)) {
        // Item links are rendered as hrefs later — http(s) only.
        if (it.date < since || !/^https?:\/\//i.test(it.link)) continue;
        if (!termHits(`${it.title} ${it.body}`, terms).length) continue;
        out.push({ externalId: sha256(it.link).slice(0, 24), url: it.link, authorHandle: `${it.author}@${host}`, title: it.title, content: `${it.title}\n${it.body}`, publishedAt: it.date, engagement: {} });
      }
    }
    // One dead feed shouldn't stop the rest; all of them failing is an error, not "0 results".
    if (failed.length && failed.length === feeds.length) throw new ProviderError("rss", `every feed failed — ${failed.join("; ").slice(0, 400)}`);
    if (failed.length) warnings?.push(`${failed.length} of ${feeds.length} feed(s) failed — ${failed.join("; ").slice(0, 400)}`);
    return out.slice(0, limit);
  },
};
