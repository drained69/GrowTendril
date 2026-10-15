CREATE TABLE "commerce_connections" (
	"project_id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"merchant_address" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"project_id" text NOT NULL,
	"event_key" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"merchant_order_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"customer_id" text NOT NULL,
	"referral_code" text,
	"authorized_micro" bigint DEFAULT 0 NOT NULL,
	"captured_micro" bigint DEFAULT 0 NOT NULL,
	"refunded_micro" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce_connections" ADD CONSTRAINT "commerce_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_event_uq" ON "commerce_events" USING btree ("project_id","event_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_uq" ON "commerce_orders" USING btree ("project_id","chain_id","contract","payment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_order_uq" ON "commerce_orders" USING btree ("project_id","merchant_order_id");
--> statement-breakpoint
UPDATE transactions SET state = 'EXCEPTION', updated_at = now() WHERE state = 'SETTLED' AND chain_check = 'mismatch';
