import { stripHtml, USER_AGENT } from "@/server/integrations/providers/http";
import { ProviderError, type FetchedPost, type MarketProvider } from "@/server/integrations/providers/types";
import { termHits } from "@/server/domain/intel/signals";
import { sha256 } from "@/server/lib/ids";
import { getPublicText, publicUrl } from "@/server/security/public-http";

/** News/blogs via RSS/Atom feeds the founder configures (RSS_FEEDS, comma-separated). */
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : undefined;
}

export function parseFeed(xml: string): { title: string; link: string; date: Date; author: string; body: string }[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const atomLink = b.match(/<link\b(?=[^>]*\bhref=["'])(?![^>]*\brel=["'](?:self|enclosure)["'])[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    return {
      title: stripHtml(tag(b, "title") ?? ""),
      link: (tag(b, "link") || atomLink || "").trim().replace(/&amp;/g, "&"),
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
  isReady: (c) => !!c.feeds,
  async search(query, { since, limit }, creds) {
    const feeds = (creds.feeds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (feeds.length > 10) throw new ProviderError("rss", "Choose at most 10 RSS feeds");
    const terms = query.split(/\s+OR\s+/i).map((t) => t.replace(/"/g, "").trim());
    const out: FetchedPost[] = [];
    let readableFeeds = 0;
    let failure = "No feed URLs are configured";
    for (const feed of feeds) {
      const res = await getPublicText(feed, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 10_000, maxBytes: 2_000_000 }).catch((e) => {
        failure = (e as Error).message;
        return null;
      });
      if (!res) continue;
      if (!res.ok) { failure = `HTTP ${res.status}`; continue; }
      if (!/<(?:rss|feed|rdf:RDF)\b/i.test(res.text)) { failure = "The URL did not return an RSS or Atom feed"; continue; }
      readableFeeds++;
      const host = new URL(feed).host;
      for (const it of parseFeed(res.text)) {
        if (!Number.isFinite(it.date.getTime()) || it.date < since || it.date.getTime() > Date.now() + 86_400_000 || !it.link) continue;
        try { it.link = publicUrl(new URL(it.link, res.url)).toString(); } catch { continue; }
        if (!termHits(`${it.title} ${it.body}`, terms).length) continue;
        out.push({ externalId: sha256(it.link).slice(0, 24), url: it.link, authorHandle: `${it.author}@${host}`, title: it.title, content: `${it.title}\n${it.body}`, publishedAt: it.date, engagement: {} });
      }
    }
    if (!readableFeeds) throw new ProviderError("rss", `Couldn't read any configured feeds: ${failure}`);
    return out.slice(0, limit);
  },
};
