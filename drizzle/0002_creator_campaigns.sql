CREATE TABLE "campaign_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"contact" text,
	"payout_address" text NOT NULL,
	"pitch" text,
	"access_token_hash" text NOT NULL,
	"tracking_campaign_id" text,
	"kol_id" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_participants_access_token_hash_unique" UNIQUE("access_token_hash")
);
--> statement-breakpoint
CREATE TABLE "campaign_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"decision_id" text,
	"transaction_id" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"url" text NOT NULL,
	"note" text,
	"observed_post_id" text,
	"disclosure_detected" boolean,
	"status" text DEFAULT 'submitted' NOT NULL,
	"review" jsonb,
	"quality_score" integer,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"post_id" text,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payout_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"experiment_id" text NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"topic" text NOT NULL,
	"topic_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brief" text NOT NULL,
	"destination_url" text NOT NULL,
	"target_event" text NOT NULL,
	"max_cost_per_action_micro" bigint NOT NULL,
	"budget_micro" bigint NOT NULL,
	"base_pay_micro" bigint NOT NULL,
	"max_posts_per_creator" integer NOT NULL,
	"discussion_bonus_cap_micro" bigint NOT NULL,
	"action_bonus_micro" bigint NOT NULL,
	"creator_cap_micro" bigint NOT NULL,
	"max_creators" integer NOT NULL,
	"disclosure_text" text NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"join_token" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"data_mode" "data_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_campaigns_join_token_unique" UNIQUE("join_token")
);
--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_campaign_id_creator_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."creator_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_tracking_campaign_id_campaigns_id_fk" FOREIGN KEY ("tracking_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_kol_id_kols_id_fk" FOREIGN KEY ("kol_id") REFERENCES "public"."kols"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payouts" ADD CONSTRAINT "campaign_payouts_campaign_id_creator_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."creator_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payouts" ADD CONSTRAINT "campaign_payouts_participant_id_campaign_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."campaign_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payouts" ADD CONSTRAINT "campaign_payouts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_payouts" ADD CONSTRAINT "campaign_payouts_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_posts" ADD CONSTRAINT "campaign_posts_campaign_id_creator_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."creator_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_posts" ADD CONSTRAINT "campaign_posts_participant_id_campaign_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."campaign_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_posts" ADD CONSTRAINT "campaign_posts_observed_post_id_social_posts_id_fk" FOREIGN KEY ("observed_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_posts" ADD CONSTRAINT "campaign_posts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rewards" ADD CONSTRAINT "campaign_rewards_campaign_id_creator_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."creator_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rewards" ADD CONSTRAINT "campaign_rewards_participant_id_campaign_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."campaign_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rewards" ADD CONSTRAINT "campaign_rewards_post_id_campaign_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."campaign_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rewards" ADD CONSTRAINT "campaign_rewards_payout_id_campaign_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."campaign_payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_campaigns" ADD CONSTRAINT "creator_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_campaigns" ADD CONSTRAINT "creator_campaigns_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_campaigns" ADD CONSTRAINT "creator_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_campaign_handle_uq" ON "campaign_participants" USING btree ("campaign_id","provider","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_posts_url_uq" ON "campaign_posts" USING btree ("campaign_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_rewards_source_uq" ON "campaign_rewards" USING btree ("campaign_id","source_key");--> statement-breakpoint
CREATE INDEX "campaign_rewards_participant_idx" ON "campaign_rewards" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_campaigns_project_number_uq" ON "creator_campaigns" USING btree ("project_id","number");