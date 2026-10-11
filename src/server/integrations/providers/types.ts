import type { Audience } from "@/server/domain/intel/market-taxonomy";

export type ProviderId = "x" | "bluesky" | "github" | "reddit" | "youtube" | "hackernews" | "rss" | "tiktok" | "discord" | "telegram";

export interface FetchedPost {
  externalId: string;
  url: string;
  authorHandle: string;
  authorName?: string;
  authorUrl?: string;
  authorFollowers?: number;
  title?: string;
  /** Organization the post is attributable to, only when the source states it (e.g. GitHub org owner). */
  companyHint?: string;
  content: string;
  publishedAt: Date;
  engagement: { likes?: number; comments?: number; shares?: number; views?: number; score?: number; stars?: number };
}

/** What a creator publishes about themselves on the platform where they were found. */
export interface CreatorProfile {
  handle: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  /** Links the creator lists on their own profile (website, other channels). */
  links: string[];
  /** A contact email the creator put on their own public profile, if any. */
  publicEmail?: string;
  location?: string;
  avatarUrl?: string;
  url: string;
}

export interface SearchOptions {
  since: Date;
  limit: number;
}

export type Credentials = Record<string, string>;

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  optional?: boolean;
  help?: string;
}

/**
 * A market-data source. Credentials come from the workspace vault (encrypted) or, failing
 * that, platform-wide env defaults. Restricted providers declare why they are not usable
 * and never return data.
 */
export interface MarketProvider {
  id: ProviderId;
  name: string;
  description: string;
  category: "social" | "code" | "community" | "video" | "news";
  docsUrl: string;
  access: "official_api" | "public_api" | "restricted";
  restrictedReason?: string;
  credentialFields: CredentialField[];
  /** Field key → env var providing a platform default. */
  envFallback: Record<string, string>;
  /** Only search this source for these customer audiences (default: all). */
  audiences?: Audience[];
  /** Whether the provider can run with these credentials (keyless providers: always). */
  isReady(creds: Credentials): boolean;
  /** When true, a scan sends its queries as one OR search (sources with strict keyless rate limits). */
  combineQueries?(creds: Credentials): boolean;
  search(query: string, opts: SearchOptions, creds: Credentials): Promise<FetchedPost[]>;
  /** Search creator profiles by topic (name/bio), where the platform offers it. */
  findCreators?(query: string, opts: { limit: number }, creds: Credentials): Promise<CreatorProfile[]>;
  /** A creator's own recent posts, to judge what they actually publish. */
  recentPosts?(handle: string, opts: SearchOptions, creds: Credentials): Promise<FetchedPost[]>;
  /** Public profile for a handle (url helps platforms keyed by channel id). */
  profile?(handle: string, creds: Credentials, url?: string | null): Promise<CreatorProfile | null>;
}

export class ProviderError extends Error {
  constructor(
    public provider: ProviderId,
    message: string,
    public status?: number,
  ) {
    super(`[${provider}] ${message}`);
  }
}
