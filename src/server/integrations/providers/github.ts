import { getJson } from "@/server/integrations/providers/http";
import type { CreatorProfile, FetchedPost, MarketProvider } from "@/server/integrations/providers/types";
import { linksIn } from "@/server/domain/growth/creator-contacts";

/** GitHub REST search (issues/discussions + repositories). Works unauthenticated at low rate; GITHUB_TOKEN raises limits. */
const headers = (token?: string): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

interface Issue {
  id: number;
  html_url: string;
  title: string;
  body: string | null;
  user: { login: string; html_url: string };
  created_at: string;
  comments: number;
  reactions?: { total_count: number };
  repository_url: string;
}
interface Repo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  owner: { login: string; html_url: string; type: string };
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  created_at: string;
  topics?: string[];
}

export const github: MarketProvider = {
  id: "github",
  name: "GitHub",
  description: "Issues and repositories via the GitHub REST search API. Used for developer products. Works without a token at a low rate limit.",
  category: "code",
  docsUrl: "https://docs.github.com/en/rest/search",
  access: "official_api",
  credentialFields: [{ key: "token", label: "Personal access token", secret: true, optional: true, placeholder: "github_pat_…", help: "Read-only public access is enough. Raises the rate limit from 10 to 30 searches/min." }],
  envFallback: { token: "GITHUB_TOKEN" },
  audiences: ["developers"],
  isReady: () => true,
  async search(query, { since, limit }, creds) {
    const day = since.toISOString().slice(0, 10);
    const per = Math.min(Math.ceil(limit / 2), 30);
    const [issues, repos] = await Promise.all([
      getJson<{ items: Issue[] }>("github", `https://api.github.com/search/issues?q=${encodeURIComponent(`${query} is:issue created:>${day}`)}&sort=created&order=desc&per_page=${per}`, { headers: headers(creds.token) }),
      getJson<{ items: Repo[] }>("github", `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} pushed:>${day}`)}&sort=updated&order=desc&per_page=${per}`, { headers: headers(creds.token) }),
    ]);
    const fromIssues = issues.items.map(
      (i): FetchedPost => ({
        externalId: `issue-${i.id}`,
        url: i.html_url,
        authorHandle: i.user.login,
        authorUrl: i.user.html_url,
        title: `${i.repository_url.split("/repos/")[1]}: ${i.title}`,
        content: `${i.title}\n${(i.body ?? "").slice(0, 3000)}`,
        publishedAt: new Date(i.created_at),
        engagement: { comments: i.comments, likes: i.reactions?.total_count ?? 0 },
      }),
    );
    const fromRepos = repos.items.map(
      (r): FetchedPost => ({
        externalId: `repo-${r.id}`,
        url: r.html_url,
        authorHandle: r.owner.login,
        authorUrl: r.owner.html_url,
        title: r.full_name,
        companyHint: r.owner.type === "Organization" ? r.owner.login : undefined,
        content: `${r.full_name}: ${r.description ?? ""} ${(r.topics ?? []).join(" ")}`,
        publishedAt: new Date(r.pushed_at),
        engagement: { stars: r.stargazers_count, shares: r.forks_count },
      }),
    );
    return [...fromIssues, ...fromRepos];
  },
  async profile(handle, creds): Promise<CreatorProfile | null> {
    const u = await getJson<{ login: string; name: string | null; bio: string | null; blog: string | null; email: string | null; twitter_username: string | null; location: string | null; followers: number; avatar_url: string; html_url: string }>(
      "github",
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      { headers: headers(creds.token) },
    ).catch(() => null);
    if (!u) return null;
    const links = [...(u.blog ? [/^https?:/.test(u.blog) ? u.blog : `https://${u.blog}`] : []), ...(u.twitter_username ? [`https://x.com/${u.twitter_username}`] : []), ...linksIn(u.bio ?? "")];
    return { handle: u.login, displayName: u.name ?? undefined, bio: u.bio ?? undefined, followers: u.followers, links, publicEmail: u.email ?? undefined, location: u.location ?? undefined, avatarUrl: u.avatar_url, url: u.html_url };
  },
};
