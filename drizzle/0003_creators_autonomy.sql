CREATE TABLE "creator_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"generated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kols" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "autonomy_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_reports" ADD CONSTRAINT "creator_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_reports_project_idx" ON "creator_reports" USING btree ("project_id","created_at");