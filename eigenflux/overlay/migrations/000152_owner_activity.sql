-- +goose Up
CREATE TABLE owner_activity_events (
    event_id BIGSERIAL PRIMARY KEY,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    target JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
    created_at BIGINT NOT NULL,
    completed_at BIGINT,
    acknowledged_at BIGINT,
    resolution TEXT
);
CREATE INDEX owner_activity_pending ON owner_activity_events(agent_id,event_id)
WHERE acknowledged_at IS NULL AND status <> 'failed';

-- +goose Down
DROP TABLE owner_activity_events;
