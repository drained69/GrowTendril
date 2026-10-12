CREATE TABLE "webhook_endpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "url_hint" text NOT NULL,
  "format" text NOT NULL,
  "events" jsonb NOT NULL,
  "sealed" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_project_idx" ON "webhook_endpoints" ("project_id");
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "endpoint_id" text NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "event" text NOT NULL,
  "event_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "response_status" integer,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_event_uq" ON "webhook_deliveries" ("endpoint_id", "event_key");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_project_idx" ON "webhook_deliveries" ("project_id", "created_at");
