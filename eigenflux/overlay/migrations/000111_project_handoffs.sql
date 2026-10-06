-- +goose Up
CREATE TABLE project_handoffs (
    handoff_id BIGINT PRIMARY KEY,
    sender_id BIGINT NOT NULL REFERENCES agents(agent_id),
    receiver_id BIGINT NOT NULL REFERENCES agents(agent_id),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    markdown TEXT NOT NULL,
    sources JSONB NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','acknowledged')),
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    acknowledged_at BIGINT,
    UNIQUE(sender_id,idempotency_key),
    CHECK(sender_id <> receiver_id)
);
CREATE INDEX project_handoffs_inbox ON project_handoffs(receiver_id,state,handoff_id DESC);
CREATE INDEX project_handoffs_sent ON project_handoffs(sender_id,handoff_id DESC);
-- +goose Down
DROP TABLE project_handoffs;
