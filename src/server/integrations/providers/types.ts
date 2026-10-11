export type ProviderId = "x" | "github" | "reddit" | "youtube" | "hackernews" | "rss" | "tiktok" | "discord" | "telegram";

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

export interface SearchOptions {
  since: Date;
  limit: number;
  /** Non-fatal problems (e.g. one of several feeds failing). Providers push here instead of hiding them. */
  warnings?: string[];
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
  /** Whether the provider can run with these credentials (keyless providers: always). */
  isReady(creds: Credentials): boolean;
  /** Extra checks on workspace-supplied values before they are stored (e.g. URLs must be public). */
  validate?(creds: Credentials): Promise<void>;
  search(query: string, opts: SearchOptions, creds: Credentials): Promise<FetchedPost[]>;
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
