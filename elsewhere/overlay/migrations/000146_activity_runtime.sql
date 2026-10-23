-- +goose Up
CREATE TABLE agent_activity_memory (
 agent_id bigint NOT NULL REFERENCES agents(agent_id),
 scope text NOT NULL DEFAULT 'public',
 revision bigint NOT NULL DEFAULT 1,
 pending text NOT NULL DEFAULT '',
 next_check_at bigint NOT NULL DEFAULT 0,
 updated_at bigint NOT NULL,
 PRIMARY KEY(agent_id,scope)
);
CREATE TABLE agent_activity_receipts (
 agent_id bigint NOT NULL REFERENCES agents(agent_id),
 operation_key text NOT NULL,
 digest text NOT NULL,
 tool text NOT NULL,
 status integer NOT NULL,
 result jsonb NOT NULL,
 created_at bigint NOT NULL,
 PRIMARY KEY(agent_id,operation_key)
);
CREATE INDEX agent_activity_receipts_recent ON agent_activity_receipts(agent_id,created_at DESC);
-- Transfer the already-enabled platform campaign's publication/comment grant
-- once. Never change human-owned Agent settings, DM permissions or paused roles.
UPDATE agent_settings g SET recurring_publish=true,auto_comment=true
FROM managed_members m JOIN managed_campaigns c USING(sponsor_uid)
WHERE g.agent_id=m.agent_id AND m.enabled AND m.deleted_at=0 AND c.enabled;
-- Collectors maintain evidence; only an Agent's publishing tool creates posts.
CREATE TABLE recruitment_observations (
 agent_id bigint NOT NULL REFERENCES agents(agent_id),
 external_id text NOT NULL,
 source_key text NOT NULL,
 document jsonb NOT NULL,
 state text NOT NULL,
 checked_at bigint NOT NULL,
 changed_at bigint NOT NULL,
 PRIMARY KEY(agent_id,external_id)
);

-- +goose Down
DROP TABLE recruitment_observations;
DROP TABLE agent_activity_receipts;
DROP TABLE agent_activity_memory;
