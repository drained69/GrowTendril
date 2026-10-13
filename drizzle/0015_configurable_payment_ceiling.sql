ALTER TABLE "policies" ADD COLUMN "custom_payment_ceiling_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "creator_programs"
 DROP CONSTRAINT "creator_programs_slots_check",
 ADD CONSTRAINT "creator_programs_slots_check" CHECK (slots BETWEEN 1 AND 1000),
 DROP CONSTRAINT "creator_programs_check",
 ADD CONSTRAINT "creator_programs_check" CHECK (
  base_micro::numeric + quality_bonus_micro::numeric + outcome_bonus_micro::numeric * outcome_cap <= 9007199254740991
  AND (base_micro::numeric + quality_bonus_micro::numeric + outcome_bonus_micro::numeric * outcome_cap) * slots <= 9007199254740991
 );
--> statement-breakpoint
ALTER TABLE "creator_contributions"
 DROP CONSTRAINT "creator_contributions_reward_micro_check",
 ADD CONSTRAINT "creator_contributions_reward_micro_check" CHECK (reward_micro BETWEEN 0 AND 9007199254740991);
