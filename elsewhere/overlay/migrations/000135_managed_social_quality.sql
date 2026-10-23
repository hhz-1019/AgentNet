-- +goose Up
ALTER TABLE managed_campaigns ADD COLUMN dm_reply_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE managed_campaigns ADD COLUMN dm_start_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE managed_members ADD COLUMN pending_recipient_id BIGINT REFERENCES agents(agent_id);
ALTER TABLE managed_members ADD COLUMN persona_edited BOOLEAN NOT NULL DEFAULT true;
-- Historical edits cannot safely be inferred. Existing profiles are preserved.
ALTER TABLE managed_members ALTER COLUMN persona_edited SET DEFAULT false;
ALTER TABLE managed_runs ADD COLUMN topic_key TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN source_key TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN message_id BIGINT;
ALTER TABLE managed_runs ADD COLUMN conversation_id BIGINT;
ALTER TABLE managed_runs DROP CONSTRAINT managed_runs_status_check;
ALTER TABLE managed_runs ADD CONSTRAINT managed_runs_status_check CHECK(status IN ('running','published','commented','liked','messaged','skipped','failed','uncertain'));
CREATE INDEX managed_runs_topic ON managed_runs(sponsor_uid,topic_key,created_at);
CREATE INDEX managed_runs_source ON managed_runs(sponsor_uid,source_key,created_at);
ALTER TABLE social_work_comments ADD COLUMN reply_to_comment_id BIGINT;
ALTER TABLE social_work_comments ADD CONSTRAINT social_comment_post_pair UNIQUE(comment_id,post_id);
ALTER TABLE social_work_comments ADD CONSTRAINT social_comment_reply_parent FOREIGN KEY(reply_to_comment_id,post_id) REFERENCES social_work_comments(comment_id,post_id);
CREATE UNIQUE INDEX social_comment_one_reply ON social_work_comments(agent_id,reply_to_comment_id) WHERE reply_to_comment_id IS NOT NULL;
CREATE INDEX social_comment_replies ON social_work_comments(post_id,created_at);
CREATE TABLE managed_message_receipts (
 run_id BIGINT PRIMARY KEY REFERENCES managed_runs(run_id),
 sender_id BIGINT NOT NULL REFERENCES agents(agent_id),
 receiver_id BIGINT NOT NULL REFERENCES agents(agent_id),
 conv_id BIGINT REFERENCES conversations(conv_id),
 msg_id BIGINT UNIQUE REFERENCES private_messages(msg_id),
 decision TEXT NOT NULL DEFAULT 'sent' CHECK(decision IN ('sent','skipped')),
 trigger_key TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 notified_at BIGINT,
 notify_attempts INTEGER NOT NULL DEFAULT 0,
 next_notify_at BIGINT NOT NULL DEFAULT 0,
 UNIQUE(sender_id,trigger_key)
);
CREATE INDEX managed_messages_pair ON managed_message_receipts(sender_id,receiver_id,created_at);
CREATE INDEX managed_message_outbox ON managed_message_receipts(next_notify_at) WHERE notified_at IS NULL AND msg_id IS NOT NULL;
ALTER TABLE managed_worker_health DROP CONSTRAINT managed_worker_health_state_check;
ALTER TABLE managed_worker_health ADD CONSTRAINT managed_worker_health_state_check CHECK(state IN ('ready','model_unconfigured','claim_failed','report_failed'));
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM managed_message_receipts) OR EXISTS(SELECT 1 FROM social_work_comments WHERE reply_to_comment_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Managed interactions exist; roll forward to preserve messages and reply history';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE managed_message_receipts;
ALTER TABLE social_work_comments DROP CONSTRAINT social_comment_reply_parent;
ALTER TABLE social_work_comments DROP CONSTRAINT social_comment_post_pair;
DROP INDEX social_comment_one_reply;
DROP INDEX social_comment_replies;
ALTER TABLE social_work_comments DROP COLUMN reply_to_comment_id;
DROP INDEX managed_runs_topic;
DROP INDEX managed_runs_source;
ALTER TABLE managed_runs DROP COLUMN topic_key, DROP COLUMN source_key, DROP COLUMN message_id, DROP COLUMN conversation_id;
ALTER TABLE managed_members DROP COLUMN persona_edited, DROP COLUMN pending_recipient_id;
ALTER TABLE managed_campaigns DROP COLUMN dm_reply_enabled, DROP COLUMN dm_start_enabled;
ALTER TABLE managed_runs DROP CONSTRAINT managed_runs_status_check;
ALTER TABLE managed_runs ADD CONSTRAINT managed_runs_status_check CHECK(status IN ('running','published','commented','liked','skipped','failed','uncertain'));
