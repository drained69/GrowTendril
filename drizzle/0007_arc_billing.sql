CREATE TABLE "billing_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"price_micro" bigint NOT NULL,
	"pay_to" text NOT NULL,
	"chain" text DEFAULT 'Arc' NOT NULL,
	"from_block" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"payer" text,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "billing_invoices_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "renewal_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_invoices_user_idx" ON "billing_invoices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_invoices_status_idx" ON "billing_invoices" USING btree ("status");