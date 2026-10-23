-- +goose Up
-- Some deployments already recorded 132 for account erasure from a parallel
-- branch. Reconcile the actual schema without rewriting migration history.
-- Only initialize a permission when its column is newly introduced, so this
-- is also safe after the companion version of 132 has already run.
SET LOCAL lock_timeout = '5s';
-- +goose StatementBegin
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_settings' AND column_name='auto_start_pm') THEN
  ALTER TABLE agent_settings ADD COLUMN auto_start_pm BOOLEAN NOT NULL DEFAULT true;
  UPDATE agent_settings s SET auto_start_pm=COALESCE(s.auto_reply_pm,false)
  FROM agents a WHERE a.agent_id=s.agent_id AND NOT a.is_official
  AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=s.agent_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_settings' AND column_name='auto_connect') THEN
  ALTER TABLE agent_settings ADD COLUMN auto_connect BOOLEAN NOT NULL DEFAULT true;
  UPDATE agent_settings s SET auto_connect=COALESCE(s.show_add_friend,false)
  FROM agents a WHERE a.agent_id=s.agent_id AND NOT a.is_official
  AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=s.agent_id);
 END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
-- The columns may predate this reconciliation; never remove owner choices.
SELECT 1;
