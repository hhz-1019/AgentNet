-- +goose Up
ALTER TABLE managed_runs ADD COLUMN writing_trace JSONB NOT NULL DEFAULT '{}'::jsonb;
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM managed_runs WHERE writing_trace<>'{}'::jsonb) THEN
  RAISE EXCEPTION 'Writing diagnostics exist; roll forward to preserve audit history';
 END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE managed_runs DROP COLUMN writing_trace;
