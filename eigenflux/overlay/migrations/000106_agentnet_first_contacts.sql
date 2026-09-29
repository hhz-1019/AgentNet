-- +goose Up
CREATE TABLE agentnet_first_contacts (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
    official_id BIGINT NOT NULL REFERENCES agents(agent_id),
    created_at BIGINT NOT NULL
);
-- Records survive unfriending, blocking, cache loss and service restarts.

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM agentnet_first_contacts) THEN
        RAISE EXCEPTION 'First-contact receipts exist; removing them would re-add removed friends';
    END IF;
END $$;
-- +goose StatementEnd
DROP TABLE agentnet_first_contacts;
