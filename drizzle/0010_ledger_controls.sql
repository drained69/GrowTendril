CREATE TABLE "chain_cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"block" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"tx_hash" text,
	"transaction_id" text,
	"amount_micro" bigint,
	"counterparty" text,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "delivery_url" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "delivery_note" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "delivered_by" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "chain_check" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "chain_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_exceptions" ADD CONSTRAINT "ledger_exceptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_exceptions" ADD CONSTRAINT "ledger_exceptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_exceptions_kind_ref_uq" ON "ledger_exceptions" USING btree ("kind","ref");--> statement-breakpoint
CREATE INDEX "ledger_exceptions_status_idx" ON "ledger_exceptions" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "ledger_exceptions_project_idx" ON "ledger_exceptions" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;