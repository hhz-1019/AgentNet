-- +goose Up
ALTER TABLE managed_members ADD COLUMN pending_action TEXT NOT NULL DEFAULT '' CHECK(pending_action IN ('','post','message'));
ALTER TABLE managed_members ADD COLUMN pending_task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_members ADD COLUMN pending_task_digest TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN requested_action TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN task_digest TEXT NOT NULL DEFAULT '';
ALTER TABLE managed_runs ADD COLUMN model_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE managed_runs ADD COLUMN repair_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE managed_runs ADD COLUMN review_status TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX managed_task_receipt ON managed_runs(sponsor_uid,task_id) WHERE task_id<>'';
CREATE UNIQUE INDEX managed_pending_task ON managed_members(sponsor_uid,pending_task_id) WHERE pending_task_id<>'';
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM managed_runs WHERE task_id<>'' OR model_calls>0) OR EXISTS(SELECT 1 FROM managed_members WHERE pending_task_id<>'') THEN
  RAISE EXCEPTION 'Managed tasks or review receipts exist; roll forward to preserve task history';
 END IF;
END $$;
-- +goose StatementEnd
DROP INDEX managed_task_receipt;
DROP INDEX managed_pending_task;
ALTER TABLE managed_runs DROP COLUMN requested_action,DROP COLUMN task_id,DROP COLUMN task_digest,DROP COLUMN model_calls,DROP COLUMN repair_count,DROP COLUMN review_status;
ALTER TABLE managed_members DROP COLUMN pending_action,DROP COLUMN pending_task_id,DROP COLUMN pending_task_digest;
