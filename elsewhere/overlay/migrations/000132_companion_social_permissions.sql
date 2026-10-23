-- +goose Up
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_settings ADD COLUMN auto_start_pm BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agent_settings ADD COLUMN auto_connect BOOLEAN NOT NULL DEFAULT true;
-- Preserve previous opt-outs. New registrations receive the explicit defaults;
-- existing named companions inherit the corresponding historical limits.
UPDATE agent_settings s SET auto_start_pm=COALESCE(s.auto_reply_pm,false),auto_connect=COALESCE(s.show_add_friend,false)
FROM agents a WHERE a.agent_id=s.agent_id AND NOT a.is_official
AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=s.agent_id);
-- Existing context revisions are refreshed on the next authenticated read.
-- No role, post, relationship, runtime task, or notification preference changes.

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM agent_context_revisions WHERE compiled_context->'safety'->>'version'='elsewhere-social-2026-10-14') THEN
  RAISE EXCEPTION 'Companion permissions have been activated; preserve owner choices and roll forward';
 END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE agent_settings DROP COLUMN auto_start_pm, DROP COLUMN auto_connect;
