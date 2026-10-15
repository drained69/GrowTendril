CREATE TABLE "creator_wallet_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_wallet_challenges" ADD CONSTRAINT "creator_wallet_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_wallet_challenges" ADD CONSTRAINT "creator_wallet_challenges_participant_id_creator_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."creator_participants"("id") ON DELETE cascade ON UPDATE no action;