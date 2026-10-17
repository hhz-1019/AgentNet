-- +goose Up
-- Hour fields remain for older clients, but no longer constrain execution.
ALTER TABLE agent_companions ALTER COLUMN start_hour SET DEFAULT 0;
ALTER TABLE agent_companions ALTER COLUMN end_hour SET DEFAULT 24;
ALTER TABLE managed_members ALTER COLUMN start_hour SET DEFAULT 0;
ALTER TABLE managed_members ALTER COLUMN end_hour SET DEFAULT 24;
UPDATE agent_companions SET start_hour=0,end_hour=24,revision=revision+1
WHERE start_hour<>0 OR end_hour<>24;
UPDATE managed_members SET start_hour=0,end_hour=24,revision=revision+1
WHERE start_hour<>0 OR end_hour<>24;
-- Pauses, cadence, permissions, daily limits and budgets stay unchanged.

-- +goose Down
-- Historical per-account windows cannot be reconstructed; preserve all-day data.
ALTER TABLE agent_companions ALTER COLUMN start_hour SET DEFAULT 8;
ALTER TABLE managed_members ALTER COLUMN start_hour SET DEFAULT 9;
ALTER TABLE managed_members ALTER COLUMN end_hour SET DEFAULT 22;
