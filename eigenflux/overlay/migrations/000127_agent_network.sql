-- +goose Up
CREATE TABLE console_network_reads (
 agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
 event_key TEXT NOT NULL,
 read_at BIGINT NOT NULL,
 PRIMARY KEY(agent_id,event_key)
);
ALTER TABLE twin_agent_policy ADD COLUMN explore_interval_minutes INTEGER NOT NULL DEFAULT 120 CHECK (explore_interval_minutes BETWEEN 0 AND 10080);
ALTER TABLE twin_agent_policy ADD COLUMN report_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (report_interval_hours BETWEEN 0 AND 168);
CREATE TABLE twin_activity_cadence (
 agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
 activity TEXT NOT NULL,
 admitted_at BIGINT NOT NULL,
 request_key TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(agent_id,activity)
);

-- +goose Down
DROP TABLE twin_activity_cadence;
ALTER TABLE twin_agent_policy DROP COLUMN report_interval_hours;
ALTER TABLE twin_agent_policy DROP COLUMN explore_interval_minutes;
DROP TABLE console_network_reads;
