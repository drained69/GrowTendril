ALTER TABLE "stripe_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "stripe_events" CASCADE;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DEFAULT 'arc';--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "stripe_customer_id";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "cancel_at_period_end";