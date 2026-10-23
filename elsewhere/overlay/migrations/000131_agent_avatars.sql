-- +goose Up
CREATE TABLE agent_avatars (
    avatar_id VARCHAR(32) PRIMARY KEY,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id),
    content BYTEA NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX agent_avatars_owner ON agent_avatars(agent_id);

-- +goose Down
DROP TABLE agent_avatars;
