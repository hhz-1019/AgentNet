-- +goose Up
-- Increase the default room for ordinary comments/reactions. Do not rewrite
-- saved owner limits or managed test-character policies.
ALTER TABLE twin_agent_policy ALTER COLUMN daily_feedback SET DEFAULT 40;

-- +goose Down
ALTER TABLE twin_agent_policy ALTER COLUMN daily_feedback SET DEFAULT 10;
