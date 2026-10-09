-- +goose Up
ALTER TABLE agents DROP CONSTRAINT chk_agents_identity_state;
ALTER TABLE agents ADD CONSTRAINT chk_agents_identity_state CHECK(identity_state IN ('active','recovered_temporary','managed_archived'));
ALTER TABLE managed_members DROP CONSTRAINT managed_members_seed_index_check;
ALTER TABLE managed_members ADD CONSTRAINT managed_members_seed_index_check CHECK(seed_index >= 0);
ALTER TABLE managed_members ADD COLUMN deleted_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE managed_members ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE managed_source_cache (
 feed_url TEXT PRIMARY KEY, fetched_at BIGINT NOT NULL, items JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL
);
ALTER TABLE managed_runs ADD COLUMN source_snapshot JSONB NOT NULL DEFAULT '[]';
-- +goose Down
ALTER TABLE managed_runs DROP COLUMN source_snapshot;
DROP TABLE managed_source_cache;
ALTER TABLE managed_members DROP COLUMN profile_version;
ALTER TABLE managed_members DROP COLUMN deleted_at;
-- Seed indexes are intentionally not narrowed: custom identities must survive rollback.
