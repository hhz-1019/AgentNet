-- +goose Up
-- Preserve pre-transition profile data before owners edit their concise card.
CREATE TABLE IF NOT EXISTS legacy_profile_archives (
 user_id VARCHAR(64) PRIMARY KEY REFERENCES human_accounts(uid),
 profile JSONB NOT NULL,
 created_at BIGINT NOT NULL
);
INSERT INTO legacy_profile_archives(user_id,profile,created_at)
SELECT user_id,to_jsonb(u),(extract(epoch from now())*1000)::bigint FROM twin_users u ON CONFLICT(user_id) DO NOTHING;
-- Memory tables and historical registration drafts remain intact.
-- +goose Down
-- Intentionally retain this archive on rollback. It is owner data, not a cache.
