-- +goose Up
ALTER TABLE managed_members ADD COLUMN pending_topic TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN provider_host TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN model TEXT NOT NULL DEFAULT '';
CREATE TABLE managed_worker_health (
 id INTEGER PRIMARY KEY CHECK (id=1),
 last_seen_at BIGINT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('ready','model_unconfigured','claim_failed'))
);
CREATE INDEX managed_delegations_sponsor ON managed_delegations(sponsor_uid);

-- +goose Down
DROP INDEX managed_delegations_sponsor;
DROP TABLE managed_worker_health;
ALTER TABLE managed_runs DROP COLUMN provider_host, DROP COLUMN model;
ALTER TABLE managed_members DROP COLUMN pending_topic;
