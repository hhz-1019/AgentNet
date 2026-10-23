-- +goose Up
CREATE TABLE managed_public_sources (
 sponsor_uid VARCHAR(64) NOT NULL REFERENCES managed_campaigns(sponsor_uid),
 source_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('celebrity','recruitment')),
 agent_id BIGINT NOT NULL REFERENCES managed_members(agent_id),
 enabled BOOLEAN NOT NULL DEFAULT false, next_run_at BIGINT NOT NULL DEFAULT 0,
 checked_at BIGINT NOT NULL DEFAULT 0, attempted_at BIGINT NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending', items JSONB NOT NULL DEFAULT '[]',
 background TEXT NOT NULL DEFAULT '', background_checked_at BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(sponsor_uid,source_key)
);
CREATE INDEX managed_public_sources_due ON managed_public_sources(next_run_at) WHERE enabled;
CREATE TABLE managed_recruitment_jobs (
 sponsor_uid VARCHAR(64) NOT NULL, source_key TEXT NOT NULL, external_id TEXT NOT NULL,
 post_id BIGINT NOT NULL REFERENCES social_work_posts(post_id), fingerprint TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('open','closed')), checked_at BIGINT NOT NULL,
 PRIMARY KEY(sponsor_uid,source_key,external_id),
 FOREIGN KEY(sponsor_uid,source_key) REFERENCES managed_public_sources(sponsor_uid,source_key)
);
ALTER TABLE managed_public_sources ADD COLUMN IF NOT EXISTS originals jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE managed_public_sources ADD COLUMN IF NOT EXISTS original_status text NOT NULL DEFAULT 'pending';
ALTER TABLE managed_public_sources ADD COLUMN IF NOT EXISTS original_checked_at bigint NOT NULL DEFAULT 0;

ALTER TABLE managed_public_sources ADD COLUMN IF NOT EXISTS background_documents jsonb NOT NULL DEFAULT '[]'::jsonb;
-- +goose Down
DROP TABLE managed_recruitment_jobs;
DROP TABLE managed_public_sources;
