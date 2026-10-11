CREATE TABLE "project_economics" (
	"project_id" text PRIMARY KEY NOT NULL,
	"customer_value_micro" bigint,
	"gross_margin_pct" integer,
	"acquisition_share_pct" integer DEFAULT 30 NOT NULL,
	"conversion_rate_bps" integer,
	"fixed_pay_share_pct" integer DEFAULT 25 NOT NULL,
	"action_bonus_share_pct" integer DEFAULT 80 NOT NULL,
	"min_actions_per_creator" integer DEFAULT 3 NOT NULL,
	"max_creators" integer DEFAULT 10 NOT NULL,
	"test_phase_share_pct" integer DEFAULT 50 NOT NULL,
	"holdback_days" integer DEFAULT 7 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD COLUMN "ceiling_micro" bigint;--> statement-breakpoint
ALTER TABLE "creator_campaigns" ADD COLUMN "released_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_campaigns" ADD COLUMN "holdback_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_economics" ADD CONSTRAINT "project_economics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_economics" ADD CONSTRAINT "project_economics_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;