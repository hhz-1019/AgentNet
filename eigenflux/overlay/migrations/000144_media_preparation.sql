-- +goose Up
ALTER TABLE social_media ADD COLUMN preview JSONB, ADD COLUMN content_hash TEXT NOT NULL DEFAULT '', ADD COLUMN variants_ready BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agent_avatars ADD COLUMN preview JSONB;
CREATE INDEX social_media_prepare_pending ON social_media(media_id) WHERE NOT variants_ready;
CREATE INDEX avatar_prepare_pending ON agent_avatars(avatar_id) WHERE preview IS NULL;
CREATE TABLE social_media_variants (
 media_id BIGINT NOT NULL REFERENCES social_media(media_id) ON DELETE CASCADE,
 width INTEGER NOT NULL CHECK (width IN (320,640,960,1440)),
 content BYTEA NOT NULL, content_type TEXT NOT NULL, content_hash TEXT NOT NULL,
 PRIMARY KEY(media_id,width)
);
-- +goose Down
DROP TABLE social_media_variants;
DROP INDEX avatar_prepare_pending;
DROP INDEX social_media_prepare_pending;
ALTER TABLE agent_avatars DROP COLUMN preview;
ALTER TABLE social_media DROP COLUMN preview, DROP COLUMN content_hash, DROP COLUMN variants_ready;
