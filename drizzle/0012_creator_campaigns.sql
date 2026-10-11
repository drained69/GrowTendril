CREATE TABLE creator_programs (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 experiment_id text NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
 topic text NOT NULL, platform text NOT NULL, brief text NOT NULL,
 slots integer NOT NULL CHECK (slots BETWEEN 1 AND 10), cash_limit_micro bigint NOT NULL CHECK (cash_limit_micro > 0),
 base_micro bigint NOT NULL CHECK (base_micro > 0), quality_bonus_micro bigint NOT NULL CHECK (quality_bonus_micro >= 0),
 outcome_bonus_micro bigint NOT NULL CHECK (outcome_bonus_micro >= 0), outcome_cap integer NOT NULL CHECK (outcome_cap BETWEEN 0 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (base_micro + quality_bonus_micro + outcome_bonus_micro * outcome_cap <= 10000000)
);
--> statement-breakpoint
CREATE TABLE creator_participants (
 id text PRIMARY KEY, program_id text NOT NULL REFERENCES creator_programs(id) ON DELETE CASCADE,
 kol_id text NOT NULL REFERENCES kols(id), campaign_id text NOT NULL UNIQUE REFERENCES campaigns(id),
 token_hash text NOT NULL UNIQUE, challenge text NOT NULL, user_id text REFERENCES users(id),
 status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','verified')),
 payout_address text, proof_url text, accepted_at timestamptz, verified_at timestamptz, verified_by text REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX creator_participant_program_kol_uq ON creator_participants(program_id,kol_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creator_participant_program_user_uq ON creator_participants(program_id,user_id);
--> statement-breakpoint
CREATE TABLE creator_contributions (
 id text PRIMARY KEY, program_id text NOT NULL REFERENCES creator_programs(id) ON DELETE CASCADE,
 participant_id text NOT NULL UNIQUE REFERENCES creator_participants(id), post_url text NOT NULL, published_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','rejected')),
 review jsonb, score integer CHECK (score BETWEEN 0 AND 100), reward_micro bigint CHECK (reward_micro BETWEEN 0 AND 10000000),
 outcome_ids jsonb NOT NULL DEFAULT '[]', reviewed_at timestamptz, reviewed_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX creator_contribution_program_post_uq ON creator_contributions(program_id,post_url);
