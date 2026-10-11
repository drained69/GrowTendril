import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  real,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * Money is stored as integer micro-USDC (1 USDC = 1_000_000) everywhere.
 * `dataMode` labels the provenance of every row a user can see.
 */
export const dataMode = pgEnum("data_mode", ["DEMO", "SIMULATED", "TESTNET", "LIVE"]);

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const micro = (name: string) => bigint(name, { mode: "number" });

// ───────────────────────────── identity ─────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Guest accounts are created for anonymous demo visitors and expire. */
  isGuest: boolean("is_guest").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    docsUrl: text("docs_url"),
    xHandle: text("x_handle"),
    githubUrl: text("github_url"),
    description: text("description").notNull().default(""),
    /** HMAC secret for the conversion-event webhook. Never sent to the browser after creation. */
    webhookSecret: text("webhook_secret").notNull(),
    onboardingStep: integer("onboarding_step").notNull().default(1),
    dataMode: dataMode("data_mode").notNull().default("LIVE"),
    /** Autopilot cadence for the operator cycle: off | hourly | every_6h | daily */
    autopilot: text("autopilot").notNull().default("off"),
    lastCycleAt: timestamp("last_cycle_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId)],
);

/** Workspace membership. Roles: owner > admin > member > viewer. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_project_user_uq").on(t.projectId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    /** sha256 of the invite token; the token itself is only shown once. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_project_idx").on(t.projectId)],
);

/** Per-workspace credentials for data providers, encrypted at rest (AES-256-GCM). */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** base64(iv | tag | ciphertext) of a JSON object of credential fields. */
    secret: text("secret").notNull(),
    /** Non-secret hint for the UI, e.g. "••••a1f3". */
    hint: text("hint"),
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    status: text("status").notNull().default("connected"), // connected | error
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_project_provider_uq").on(t.projectId, t.provider)],
);

/** Durable background jobs (operator cycles, settlement polling, deposits). Leased by the worker. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // cycle | settlements | gateway_deposit | cleanup
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    /** Prevents duplicate scheduling of the same logical job. */
    dedupeKey: text("dedupe_key").unique(),
    trigger: text("trigger").notNull().default("system"), // system | user | schedule
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_due_idx").on(t.status, t.runAt), index("jobs_project_idx").on(t.projectId, t.createdAt)],
);

// ───────────────────────────── product intelligence ─────────────────────────────

export const productProfiles = pgTable("product_profiles", {
  id: id(),
  projectId: text("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  category: text("category").notNull(),
  targetUsers: jsonb("target_users").$type<string[]>().notNull().default([]),
  competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
  valueProps: jsonb("value_props").$type<string[]>().notNull().default([]),
  integrations: jsonb("integrations").$type<string[]>().notNull().default([]),
  useCases: jsonb("use_cases").$type<string[]>().notNull().default([]),
  pricing: text("pricing"),
  terminology: jsonb("terminology").$type<string[]>().notNull().default([]),
  /** Search terms the discovery engine uses across providers. */
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  crawledSources: jsonb("crawled_sources").$type<{ url: string; ok: boolean; note?: string }[]>().notNull().default([]),
  generatedBy: text("generated_by").notNull(), // 'claude' | 'heuristic' | 'founder' | 'demo'
  founderEdited: boolean("founder_edited").notNull().default(false),
  updatedAt: updatedAt(),
});

export const icps = pgTable(
  "icps",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(), // primary | secondary
    title: text("title").notNull(),
    description: text("description").notNull(),
    companySize: text("company_size"),
    segments: jsonb("segments").$type<string[]>().notNull().default([]),
    signals: jsonb("signals").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("icps_project_idx").on(t.projectId)],
);

// ───────────────────────────── missions & budget ─────────────────────────────

export const missions = pgTable(
  "missions",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    template: text("template").notNull(), // first_100_customers | first_100_users | qualified_leads | first_100_devs | find_buyers | own_narrative | kol_discovery | custom
    name: text("name").notNull(),
    goalDescription: text("goal_description").notNull(),
    /** Conversion event that counts toward the goal. */
    goalEvent: text("goal_event").notNull(),
    goalTarget: integer("goal_target").notNull(),
    budgetMicro: micro("budget_micro").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"), // active | paused | completed
    dataMode: dataMode("data_mode").notNull().default("LIVE"),
    createdAt: createdAt(),
  },
  (t) => [index("missions_project_idx").on(t.projectId)],
);

export const missionBudgets = pgTable(
  "mission_budgets",
  {
    id: id(),
    missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // research | kol | bounty | content | services | community
    allocatedMicro: micro("allocated_micro").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("mission_budget_cat_uq").on(t.missionId, t.category)],
);

export const policies = pgTable("policies", {
  id: id(),
  projectId: text("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  maxTransactionMicro: micro("max_transaction_micro").notNull(),
  dailySpendMicro: micro("daily_spend_micro").notNull(),
  kolApprovalThresholdMicro: micro("kol_approval_threshold_micro").notNull(),
  bountyApprovalThresholdMicro: micro("bounty_approval_threshold_micro").notNull(),
  /** Absolute ceiling — anything above is denied, approval or not. */
  hardCeilingMicro: micro("hard_ceiling_micro").notNull(),
  autonomousCategories: jsonb("autonomous_categories").$type<string[]>().notNull(),
  approvalCategories: jsonb("approval_categories").$type<string[]>().notNull(),
  forbiddenActions: jsonb("forbidden_actions").$type<string[]>().notNull(),
  /** Hostnames of x402 services the agent may buy from without approval. `*` = any marketplace-listed service. */
  approvedServiceHosts: jsonb("approved_service_hosts").$type<string[]>().notNull(),
  allowedTokens: jsonb("allowed_tokens").$type<string[]>().notNull(),
  allowedChains: jsonb("allowed_chains").$type<string[]>().notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
});

// ───────────────────────────── market data ─────────────────────────────

export const sources = pgTable(
  "sources",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // github | hackernews | reddit | youtube | x | rss | website | x402 | demo
    url: text("url").notNull(),
    title: text("title"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    dataMode: dataMode("data_mode").notNull(),
  },
  (t) => [uniqueIndex("sources_project_url_uq").on(t.projectId, t.url)],
);

export const socialPosts = pgTable(
  "social_posts",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    authorHandle: text("author_handle").notNull(),
    authorName: text("author_name"),
    authorUrl: text("author_url"),
    authorFollowers: integer("author_followers"),
    title: text("title"),
    content: text("content").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    engagement: jsonb("engagement").$type<{ likes?: number; comments?: number; shares?: number; views?: number; score?: number; stars?: number }>().notNull().default({}),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    entities: jsonb("entities").$type<{ companies: string[]; products: string[]; people: string[] }>().notNull().default({ companies: [], products: [], people: [] }),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("posts_ext_uq").on(t.projectId, t.provider, t.externalId),
    index("posts_published_idx").on(t.projectId, t.publishedAt),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    description: text("description"),
    githubOrg: text("github_org"),
    xHandle: text("x_handle"),
    /** Component scores 0-100 + explanations, see lib/scoring/intent.ts */
    scores: jsonb("scores").$type<Record<string, unknown>>().notNull().default({}),
    overallScore: integer("overall_score").notNull().default(0),
    fitScore: integer("fit_score").notNull().default(0),
    intentScore: integer("intent_score").notNull().default(0),
    /** Agent confidence that this is a real, qualified opportunity (0-1). */
    confidence: real("confidence").notNull().default(0),
    whyNow: jsonb("why_now").$type<string[]>().notNull().default([]),
    whyFit: text("why_fit"),
    recommendedAction: text("recommended_action"),
    status: text("status").notNull().default("candidate"), // candidate | qualified | contacted | dismissed
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("companies_project_name_uq").on(t.projectId, t.name)],
);

export const people = pgTable(
  "people",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    handle: text("handle"),
    provider: text("provider"),
    role: text("role"),
    url: text("url"),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("people_project_handle_uq").on(t.projectId, t.provider, t.handle)],
);

export const kols = pgTable(
  "kols",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    url: text("url"),
    followers: integer("followers"),
    /** Eight component scores with explanations, see lib/scoring/kol.ts */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    overallScore: integer("overall_score").notNull().default(0),
    whyNow: jsonb("why_now").$type<string[]>().notNull().default([]),
    recommendedAngle: text("recommended_angle"),
    payoutAddress: text("payout_address"),
    status: text("status").notNull().default("candidate"), // candidate | shortlisted | engaged | dismissed
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("kols_project_handle_uq").on(t.projectId, t.provider, t.handle)],
);

export const narratives = pgTable(
  "narratives",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    terms: jsonb("terms").$type<string[]>().notNull().default([]),
    status: text("status").notNull(), // EMERGING | ACCELERATING | PEAKING | DECLINING | CONTROVERSIAL | UNDEREXPLORED | STABLE
    volume7d: integer("volume_7d").notNull().default(0),
    volumePrev7d: integer("volume_prev_7d").notNull().default(0),
    velocityPct: integer("velocity_pct").notNull().default(0),
    relevance: integer("relevance").notNull().default(0),
    controversy: real("controversy").notNull().default(0),
    summary: text("summary"),
    dataMode: dataMode("data_mode").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("narratives_project_key_uq").on(t.projectId, t.key)],
);

export const narrativePosts = pgTable(
  "narrative_posts",
  {
    narrativeId: text("narrative_id").notNull().references(() => narratives.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => socialPosts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.narrativeId, t.postId] })],
);

export const narrativeCompanies = pgTable(
  "narrative_companies",
  {
    narrativeId: text("narrative_id").notNull().references(() => narratives.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.narrativeId, t.companyId] })],
);

export const narrativeKols = pgTable(
  "narrative_kols",
  {
    narrativeId: text("narrative_id").notNull().references(() => narratives.id, { onDelete: "cascade" }),
    kolId: text("kol_id").notNull().references(() => kols.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.narrativeId, t.kolId] })],
);

export const productMentions = pgTable(
  "product_mentions",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().unique().references(() => socialPosts.id, { onDelete: "cascade" }),
    sentiment: text("sentiment").notNull(), // positive | negative | neutral
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    issueKey: text("issue_key"),
    competitor: text("competitor"),
    churnRisk: boolean("churn_risk").notNull().default(false),
    purchaseIntent: boolean("purchase_intent").notNull().default(false),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
  },
);

export const productIssues = pgTable(
  "product_issues",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    mentions7d: integer("mentions_7d").notNull().default(0),
    mentionsPrev7d: integer("mentions_prev_7d").notNull().default(0),
    changePct: integer("change_pct").notNull().default(0),
    segment: text("segment"),
    recommendation: text("recommendation"),
    blocksAcquisition: boolean("blocks_acquisition").notNull().default(false),
    dataMode: dataMode("data_mode").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("issues_project_key_uq").on(t.projectId, t.key)],
);

// ───────────────────────────── opportunities & experiments ─────────────────────────────

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    missionId: text("mission_id").references(() => missions.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    /** e.g. "company:<id>" — one opportunity per subject; re-analysis updates it. */
    subjectKey: text("subject_key").notNull(),
    type: text("type").notNull(), // CUSTOMER | KOL | NARRATIVE | PARTNERSHIP | CONTENT | COMMUNITY | DEVELOPER | PRODUCT_ISSUE | COMPETITOR | EVENT
    secondaryType: text("secondary_type"),
    title: text("title").notNull(),
    whyNow: jsonb("why_now").$type<string[]>().notNull().default([]),
    recommendedAction: text("recommended_action").notNull(),
    confidence: real("confidence").notNull(),
    expectedValue: text("expected_value").notNull(), // LOW | MEDIUM | HIGH
    estimatedCostMicro: micro("estimated_cost_micro").notNull().default(0),
    scores: jsonb("scores").$type<Record<string, unknown>>().notNull().default({}),
    overallScore: integer("overall_score").notNull().default(0),
    status: text("status").notNull().default("open"), // open | researching | experiment | dismissed | won
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    kolId: text("kol_id").references(() => kols.id, { onDelete: "set null" }),
    narrativeId: text("narrative_id").references(() => narratives.id, { onDelete: "set null" }),
    issueId: text("issue_id").references(() => productIssues.id, { onDelete: "set null" }),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("opps_project_number_uq").on(t.projectId, t.number), uniqueIndex("opps_project_subject_uq").on(t.projectId, t.subjectKey)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    kolId: text("kol_id").references(() => kols.id, { onDelete: "cascade" }),
    narrativeId: text("narrative_id").references(() => narratives.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    /** x402 purchase that produced this evidence, if any. */
    purchaseId: text("purchase_id"),
    /** Natural key so re-analysis never duplicates evidence. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title"),
    provider: text("provider").notNull(),
    excerpt: text("excerpt").notNull(),
    signalType: text("signal_type").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    weight: real("weight").notNull().default(1),
    classifiedBy: text("classified_by").notNull(), // rule | claude | x402 | demo
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_company_idx").on(t.companyId),
    index("evidence_kol_idx").on(t.kolId),
    index("evidence_narrative_idx").on(t.narrativeId),
    index("evidence_opp_idx").on(t.opportunityId),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    hypothesis: text("hypothesis").notNull(),
    channel: text("channel").notNull(), // kol | content | bounty | research | community | partnership
    budgetCategory: text("budget_category").notNull(),
    target: text("target").notNull(),
    action: text("action").notNull(),
    budgetMicro: micro("budget_micro").notNull(),
    successEvent: text("success_event").notNull(),
    successTarget: integer("success_target").notNull(),
    /** Stop if CPA exceeds maxCpaMicro once afterSpendMicro has been spent. */
    stopMaxCpaMicro: micro("stop_max_cpa_micro").notNull(),
    stopAfterSpendMicro: micro("stop_after_spend_micro").notNull(),
    timeframeDays: integer("timeframe_days").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull().default("proposed"), // proposed | awaiting_approval | running | succeeded | failed | stopped
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("experiments_project_number_uq").on(t.projectId, t.number)],
);

export const campaigns = pgTable("campaigns", {
  id: id(),
  experimentId: text("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
  kolId: text("kol_id").references(() => kols.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  utmSource: text("utm_source").notNull(),
  utmMedium: text("utm_medium").notNull(),
  utmCampaign: text("utm_campaign").notNull(),
  referralCode: text("referral_code").notNull().unique(),
  destinationUrl: text("destination_url").notNull(),
  brief: jsonb("brief").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const conversionEvents = pgTable(
  "conversion_events",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(), // visit | signup | wallet_connect | sdk_key_created | sdk_install | demo_request | purchase | custom
    customName: text("custom_name"),
    visitorId: text("visitor_id"),
    referralCode: text("referral_code"),
    valueMicro: micro("value_micro").notNull().default(0),
    source: text("source").notNull(), // redirect | webhook | demo
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("events_project_idx").on(t.projectId, t.eventType)],
);

export const attribution = pgTable("attribution", {
  id: id(),
  conversionEventId: text("conversion_event_id").notNull().unique().references(() => conversionEvents.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  experimentId: text("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
  model: text("model").notNull(), // referral_code (deterministic first-party join)
  weight: real("weight").notNull().default(1),
  createdAt: createdAt(),
});

// ───────────────────────────── agent decisions & money ─────────────────────────────

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(), // manual | schedule | demo
  status: text("status").notNull(), // running | completed | failed
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
  log: jsonb("log").$type<{ at: string; agent: string; message: string }[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const agentDecisions = pgTable(
  "agent_decisions",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    missionId: text("mission_id").references(() => missions.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    agent: text("agent").notNull(), // operator | budget | strategist | ...
    kind: text("kind").notNull(),
    /** The Zod-validated structured action. */
    action: jsonb("action").$type<Record<string, unknown>>().notNull(),
    rationale: text("rationale").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    policyVerdict: text("policy_verdict"), // ALLOW | APPROVAL_REQUIRED | DENY | null for non-financial
    policyChecks: jsonb("policy_checks").$type<{ rule: string; passed: boolean; detail: string }[]>().notNull().default([]),
    status: text("status").notNull(), // proposed | executed | awaiting_approval | approved | rejected | denied | failed
    result: jsonb("result").$type<Record<string, unknown>>(),
    autonomous: boolean("autonomous").notNull().default(true),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("decisions_project_number_uq").on(t.projectId, t.number)],
);

export const decisionReceipts = pgTable("decision_receipts", {
  id: id(),
  decisionId: text("decision_id").notNull().unique().references(() => agentDecisions.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  /** sha256 of the canonical body — makes later tampering detectable. */
  digest: text("digest").notNull(),
  createdAt: createdAt(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
});

export const wallets = pgTable("wallets", {
  id: id(),
  projectId: text("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // circle_dcw | local_testnet | unconfigured
  address: text("address"),
  circleWalletId: text("circle_wallet_id"),
  circleWalletSetId: text("circle_wallet_set_id"),
  blockchain: text("blockchain").notNull().default("ARC-TESTNET"),
  status: text("status").notNull(), // ACTIVE | NOT_CONFIGURED | PAUSED
  /** Founder kill switch: when true every spend is denied. */
  frozen: boolean("frozen").notNull().default(false),
  dataMode: dataMode("data_mode").notNull(),
  createdAt: createdAt(),
});

export const vendors = pgTable("vendors", {
  id: id(),
  name: text("name").notNull().unique(),
  category: text("category"),
  website: text("website"),
  description: text("description"),
  source: text("source").notNull(), // circle_marketplace | growtendril (bundled seller; rows made before the rename say growthos) | manual
  createdAt: createdAt(),
});

export const services = pgTable("services", {
  id: id(),
  vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  resourceUrl: text("resource_url").notNull().unique(),
  method: text("method").notNull().default("GET"),
  description: text("description").notNull(),
  category: text("category"),
  priceMicro: micro("price_micro"),
  network: text("network"),
  payTo: text("pay_to"),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  inputSchema: jsonb("input_schema").$type<Record<string, unknown>>(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    walletId: text("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
    decisionId: text("decision_id").notNull().references(() => agentDecisions.id, { onDelete: "cascade" }),
    missionId: text("mission_id").references(() => missions.id, { onDelete: "set null" }),
    experimentId: text("experiment_id").references(() => experiments.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // x402_purchase | send | bridge | gateway_deposit
    rail: text("rail").notNull(), // gateway_x402 | app_kit_send | app_kit_bridge | gateway_deposit
    budgetCategory: text("budget_category").notNull(),
    amountMicro: micro("amount_micro").notNull(),
    token: text("token").notNull().default("USDC"),
    chain: text("chain").notNull(),
    destChain: text("dest_chain"),
    recipient: text("recipient"),
    state: text("state").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    txHash: text("tx_hash"),
    settlementId: text("settlement_id"),
    settlementStatus: text("settlement_status"),
    batchTxHash: text("batch_tx_hash"),
    explorerUrl: text("explorer_url"),
    error: text("error"),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tx_project_idx").on(t.projectId, t.createdAt)],
);

export const transactionEvents = pgTable("transaction_events", {
  id: id(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const x402Purchases = pgTable("x402_purchases", {
  id: id(),
  transactionId: text("transaction_id").notNull().unique().references(() => transactions.id, { onDelete: "cascade" }),
  serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
  resourceUrl: text("resource_url").notNull(),
  method: text("method").notNull(),
  priceMicro: micro("price_micro").notNull(),
  purpose: text("purpose").notNull(),
  payer: text("payer"),
  network: text("network"),
  httpStatus: integer("http_status"),
  responseDigest: text("response_digest"),
  responseExcerpt: jsonb("response_excerpt").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    decisionId: text("decision_id").notNull().unique().references(() => agentDecisions.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    requestedMicro: micro("requested_micro").notNull(),
    approvedMicro: micro("approved_micro"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_project_status_idx").on(t.projectId, t.status)],
);

export const learnings = pgTable("learnings", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  decisionId: text("decision_id").references(() => agentDecisions.id, { onDelete: "set null" }),
  findings: jsonb("findings").$type<Record<string, unknown>[]>().notNull(),
  reallocations: jsonb("reallocations").$type<Record<string, unknown>[]>().notNull(),
  dataMode: dataMode("data_mode").notNull(),
  createdAt: createdAt(),
});

export const dailyBriefs = pgTable(
  "daily_briefs",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("briefs_project_date_uq").on(t.projectId, t.date)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(), // user | agent | system | webhook
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_project_idx").on(t.projectId, t.at)],
);

// ───────────────────────────── creator campaigns ─────────────────────────────
/**
 * Opt-in creator campaigns: a business funds a small, measurable experiment; creators join under
 * rules they can read before posting, and earn per accepted post plus capped bonuses for useful
 * discussion and verified customer actions. Every reward line carries its reason and evidence.
 * Backed by an experiment (budget, attribution) and one tracking link per accepted creator.
 */
export const creatorCampaigns = pgTable(
  "creator_campaigns",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    experimentId: text("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    topic: text("topic").notNull(),
    topicTerms: jsonb("topic_terms").$type<string[]>().notNull().default([]),
    brief: text("brief").notNull(),
    destinationUrl: text("destination_url").notNull(),
    targetEvent: text("target_event").notNull(),
    maxCostPerActionMicro: micro("max_cost_per_action_micro").notNull(),
    budgetMicro: micro("budget_micro").notNull(),
    basePayMicro: micro("base_pay_micro").notNull(),
    maxPostsPerCreator: integer("max_posts_per_creator").notNull(),
    discussionBonusCapMicro: micro("discussion_bonus_cap_micro").notNull(),
    actionBonusMicro: micro("action_bonus_micro").notNull(),
    creatorCapMicro: micro("creator_cap_micro").notNull(),
    maxCreators: integer("max_creators").notNull(),
    disclosureText: text("disclosure_text").notNull(),
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    plan: jsonb("plan").$type<Record<string, unknown>>().notNull().default({}),
    /** Budget released to creator ceilings so far. Starts at the test phase; grows only by reallocation to measured winners. */
    releasedMicro: micro("released_micro").notNull().default(0),
    /** Verified actions become payable only after this many days (time to catch fake or reversed actions). */
    holdbackDays: integer("holdback_days").notNull().default(7),
    joinToken: text("join_token").notNull().unique(),
    status: text("status").notNull().default("open"), // open | closed
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    dataMode: dataMode("data_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("creator_campaigns_project_number_uq").on(t.projectId, t.number)],
);

export const campaignParticipants = pgTable(
  "campaign_participants",
  {
    id: id(),
    campaignId: text("campaign_id").notNull().references(() => creatorCampaigns.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    contact: text("contact"),
    payoutAddress: text("payout_address").notNull(),
    pitch: text("pitch"),
    accessTokenHash: text("access_token_hash").notNull().unique(),
    /** Per-creator ceiling; null means the campaign's base ceiling. Raised only by results-based reallocation. */
    ceilingMicro: micro("ceiling_micro"),
    trackingCampaignId: text("tracking_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    kolId: text("kol_id").references(() => kols.id, { onDelete: "set null" }),
    status: text("status").notNull().default("applied"), // applied | accepted | declined | removed
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("participants_campaign_handle_uq").on(t.campaignId, t.provider, t.handle)],
);

export const campaignPosts = pgTable(
  "campaign_posts",
  {
    id: id(),
    campaignId: text("campaign_id").notNull().references(() => creatorCampaigns.id, { onDelete: "cascade" }),
    participantId: text("participant_id").notNull().references(() => campaignParticipants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    note: text("note"),
    observedPostId: text("observed_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    disclosureDetected: boolean("disclosure_detected"),
    status: text("status").notNull().default("submitted"), // submitted | accepted | rejected
    review: jsonb("review").$type<{ relevance: number; depth: number; accuracy: number; disclosure: boolean; discussion: number; note: string } | null>(),
    qualityScore: integer("quality_score"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_posts_url_uq").on(t.campaignId, t.url)],
);

export const campaignPayouts = pgTable("campaign_payouts", {
  id: id(),
  campaignId: text("campaign_id").notNull().references(() => creatorCampaigns.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull().references(() => campaignParticipants.id, { onDelete: "cascade" }),
  amountMicro: micro("amount_micro").notNull(),
  decisionId: text("decision_id"),
  transactionId: text("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const campaignRewards = pgTable(
  "campaign_rewards",
  {
    id: id(),
    campaignId: text("campaign_id").notNull().references(() => creatorCampaigns.id, { onDelete: "cascade" }),
    participantId: text("participant_id").notNull().references(() => campaignParticipants.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => campaignPosts.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // post | discussion | action
    /** Dedupe key: one reward per post per kind, one per conversion event. */
    sourceKey: text("source_key").notNull(),
    amountMicro: micro("amount_micro").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").$type<{ url?: string; eventId?: string; eventType?: string; occurredAt?: string; review?: Record<string, unknown> }>().notNull().default({}),
    payoutId: text("payout_id").references(() => campaignPayouts.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaign_rewards_source_uq").on(t.campaignId, t.sourceKey), index("campaign_rewards_participant_idx").on(t.participantId)],
);

/**
 * Per-project campaign economics. Every planner figure is either one of these settings, a value the
 * business typed into a campaign, or a figure measured from the project's own events and ledger.
 */
export const projectEconomics = pgTable("project_economics", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  /** What one paying customer is worth (e.g. first-year revenue). Null = not set. */
  customerValueMicro: micro("customer_value_micro"),
  grossMarginPct: integer("gross_margin_pct"),
  /** Share of a customer's margin the business will spend to acquire one. */
  acquisitionSharePct: integer("acquisition_share_pct").notNull().default(30),
  /** Manual override for the action→customer rate (basis points), used when not enough data is measured. */
  conversionRateBps: integer("conversion_rate_bps"),
  fixedPaySharePct: integer("fixed_pay_share_pct").notNull().default(25),
  actionBonusSharePct: integer("action_bonus_share_pct").notNull().default(80),
  minActionsPerCreator: integer("min_actions_per_creator").notNull().default(3),
  maxCreators: integer("max_creators").notNull().default(10),
  testPhaseSharePct: integer("test_phase_share_pct").notNull().default(50),
  holdbackDays: integer("holdback_days").notNull().default(7),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});
