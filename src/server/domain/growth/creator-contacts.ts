import type { CreatorProfile } from "@/server/integrations/providers/types";

/**
 * Contact routes for a creator, built only from what they publish on their own public
 * profile. GrowTendril never looks a person up elsewhere, and never sends messages: the
 * founder reaches out personally.
 */

export interface ContactRoute {
  kind: "email" | "website" | "social" | "profile";
  label: string;
  value: string;
  href: string;
  note: string;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URLISH = /\bhttps?:\/\/[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+(?:com|co\.uk|co|io|net|org|me|tv|app|dev|xyz|link|page|shop|store|blog|studio|art|ai|social|bio|ca|de|fr)(?:\/[^\s<>()"']*)?/gi;
const IGNORED_EMAIL_DOMAINS = /(example\.(com|org)|sentry\.io|wixpress\.com)$/i;

export function emailsIn(text: string): string[] {
  return [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()).filter((e) => !IGNORED_EMAIL_DOMAINS.test(e.split("@")[1])))];
}

export function linksIn(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.replace(EMAIL, " ").match(URLISH) ?? []) {
    const cleaned = raw.replace(/[.,;:!?)\]]+$/, "");
    try {
      const u = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
      // Bluesky handles look like domains but are not websites.
      if (u.hostname.includes(".") && !/\.bsky\.social$/i.test(u.hostname)) out.add(u.toString().replace(/\/$/, ""));
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/i, "Instagram"],
  [/(^|\.)tiktok\.com$/i, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "YouTube"],
  [/(^|\.)(x\.com|twitter\.com)$/i, "X"],
  [/(^|\.)bsky\.app$/i, "Bluesky"],
  [/(^|\.)linkedin\.com$/i, "LinkedIn"],
  [/(^|\.)threads\.net$/i, "Threads"],
  [/(^|\.)substack\.com$/i, "Substack"],
  [/(^|\.)patreon\.com$/i, "Patreon"],
  [/(^|\.)twitch\.tv$/i, "Twitch"],
  [/(^|\.)github\.com$/i, "GitHub"],
  [/(^|\.)(linktr\.ee|beacons\.(ai|page)|lit\.link|bio\.link|linkin\.bio)$/i, "Link page"],
];

const PLATFORM: Record<string, string> = { bluesky: "Bluesky", x: "X", github: "GitHub", hackernews: "Hacker News", youtube: "YouTube", reddit: "Reddit" };

export function contactRoutes(provider: string, profile: CreatorProfile): ContactRoute[] {
  const routes: ContactRoute[] = [];
  const platform = PLATFORM[provider] ?? provider;
  const emails = [...new Set([...(profile.publicEmail ? [profile.publicEmail.toLowerCase()] : []), ...emailsIn(profile.bio ?? "")])];
  for (const e of emails.slice(0, 2)) routes.push({ kind: "email", label: "Email", value: e, href: `mailto:${e}`, note: `Listed on their ${platform} profile` });
  const seen = new Set<string>();
  for (const l of [...profile.links, ...linksIn(profile.bio ?? "")]) {
    let host: string;
    try {
      host = new URL(l).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seen.has(l.toLowerCase())) continue;
    seen.add(l.toLowerCase());
    const social = SOCIAL_HOSTS.find(([re]) => re.test(host));
    routes.push(
      social
        ? { kind: "social", label: social[1], value: l.replace(/^https?:\/\/(www\.)?/, ""), href: l, note: `Linked from their ${platform} profile` }
        : { kind: "website", label: "Website", value: host, href: l, note: `Linked from their ${platform} profile` },
    );
    if (routes.length >= 6) break;
  }
  routes.push({ kind: "profile", label: `${platform} profile`, value: `@${profile.handle}`, href: profile.url, note: provider === "hackernews" ? "Reply in a public thread" : "Reply publicly or send a personal message" });
  return routes;
}
