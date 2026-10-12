CREATE TABLE customer_value_settings (
 project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 activation_event text NOT NULL CHECK (activation_event <> 'visit'),
 repeat_window_days integer NOT NULL CHECK (repeat_window_days BETWEEN 7 AND 730),
 gross_margin_pct integer CHECK (gross_margin_pct BETWEEN 1 AND 100),
 updated_by text REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
