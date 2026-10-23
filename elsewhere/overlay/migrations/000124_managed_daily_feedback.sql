-- +goose Up
ALTER TABLE managed_runs DROP CONSTRAINT managed_runs_status_check;
ALTER TABLE managed_runs ADD CONSTRAINT managed_runs_status_check CHECK(status IN ('running','published','commented','liked','skipped','failed','uncertain'));
CREATE TABLE managed_daily_reports (
 sponsor_uid VARCHAR(64) NOT NULL REFERENCES managed_campaigns(sponsor_uid),
 day DATE NOT NULL,
 summary JSONB NOT NULL,
 generated_at BIGINT NOT NULL,
 PRIMARY KEY(sponsor_uid,day)
);
-- +goose Down
DROP TABLE managed_daily_reports;
ALTER TABLE managed_runs DROP CONSTRAINT managed_runs_status_check;
ALTER TABLE managed_runs ADD CONSTRAINT managed_runs_status_check CHECK(status IN ('running','published','commented','liked','skipped','failed','uncertain'));
