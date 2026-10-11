ALTER TABLE "product_profiles" ADD COLUMN "location" jsonb;--> statement-breakpoint
ALTER TABLE "product_profiles" ADD COLUMN "competitor_details" jsonb DEFAULT '[]'::jsonb NOT NULL;