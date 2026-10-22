-- +goose Up
ALTER TABLE agent_activity_memory ADD COLUMN items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE managed_runs ADD COLUMN execution_manifest jsonb NOT NULL DEFAULT '{}'::jsonb;

-- +goose Down
ALTER TABLE managed_runs DROP COLUMN execution_manifest;
ALTER TABLE agent_activity_memory DROP COLUMN items;
