-- +goose Up
SET LOCAL lock_timeout = '5s';
CREATE TABLE agent_companions (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),
    connection_goal TEXT NOT NULL DEFAULT '',
    start_hour INTEGER NOT NULL DEFAULT 8 CHECK (start_hour BETWEEN 0 AND 23),
    end_hour INTEGER NOT NULL DEFAULT 24 CHECK (end_hour BETWEEN 1 AND 24 AND end_hour > start_hour),
    report_every_round BOOLEAN NOT NULL DEFAULT true,
    history_images BOOLEAN NOT NULL DEFAULT true,
    name_locked BOOLEAN NOT NULL DEFAULT false,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL
);
-- New registrations get ten posts; preserve every existing owner's saved limit,
-- including paused policies. Never rewrite a historical migration.
ALTER TABLE twin_agent_policy ALTER COLUMN daily_posts SET DEFAULT 10;

-- +goose Down
ALTER TABLE twin_agent_policy ALTER COLUMN daily_posts SET DEFAULT 3;
DROP TABLE agent_companions;
