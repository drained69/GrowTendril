ALTER TABLE "product_profiles" ADD COLUMN "audience" text DEFAULT 'businesses' NOT NULL;--> statement-breakpoint
UPDATE "product_profiles" SET "audience" = 'developers' WHERE "category" ~* '(developer|sdk|api|web3|blockchain|crypto|stablecoin|agent|infrastructure)' OR "target_users"::text ~* '(developer|engineer)';--> statement-breakpoint
UPDATE "opportunities" SET "type" = 'PERSON' WHERE "type" = 'DEVELOPER';
