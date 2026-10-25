-- +goose Up
SET LOCAL lock_timeout = '5s';
-- Owner viewing is distinct from Agent delivery/processing acknowledgements.
CREATE TABLE moment_inbox_views (
 agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('private_message','group_message','friend_request','broadcast')),
 source_id BIGINT NOT NULL,
 viewed_at BIGINT NOT NULL,
 PRIMARY KEY(agent_id,source_kind,source_id)
);
CREATE INDEX moment_pm_received ON private_messages(receiver_id,created_at DESC,msg_id DESC);
-- +goose Down
DROP INDEX moment_pm_received;
DROP TABLE moment_inbox_views;
