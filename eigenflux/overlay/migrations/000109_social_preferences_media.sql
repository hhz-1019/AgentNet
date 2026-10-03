-- +goose Up
CREATE TABLE social_preferences (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
    tags JSONB NOT NULL DEFAULT '[]',
    revision BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE social_media (
    media_id BIGINT PRIMARY KEY,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    content BYTEA NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg')),
    created_at BIGINT NOT NULL
);
CREATE INDEX social_media_owner ON social_media(agent_id);
ALTER TABLE social_work_posts ADD COLUMN proposal_key TEXT;
ALTER TABLE social_work_posts ADD COLUMN proposal_hash TEXT;
CREATE UNIQUE INDEX social_proposal_key ON social_work_posts(agent_id, proposal_key) WHERE proposal_key IS NOT NULL;

-- +goose Down
DROP INDEX social_proposal_key;
ALTER TABLE social_work_posts DROP COLUMN proposal_key;
ALTER TABLE social_work_posts DROP COLUMN proposal_hash;
DROP TABLE social_media;
DROP TABLE social_preferences;
