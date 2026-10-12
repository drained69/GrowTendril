CREATE TABLE "customer_value_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"activation_event" text NOT NULL,
	"repeat_window_days" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_value_settings" ADD CONSTRAINT "customer_value_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_value_settings" ADD CONSTRAINT "customer_value_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;