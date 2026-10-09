-- +goose Up
CREATE TABLE managed_campaigns (
 sponsor_uid VARCHAR(64) PRIMARY KEY REFERENCES human_accounts(uid),
 enabled BOOLEAN NOT NULL DEFAULT false,
 monthly_budget_fen BIGINT NOT NULL DEFAULT 0 CHECK(monthly_budget_fen BETWEEN 0 AND 10000000),
 input_fen_per_million BIGINT NOT NULL DEFAULT 0 CHECK(input_fen_per_million BETWEEN 0 AND 1000000),
 output_fen_per_million BIGINT NOT NULL DEFAULT 0 CHECK(output_fen_per_million BETWEEN 0 AND 1000000),
 revision BIGINT NOT NULL DEFAULT 1
);
CREATE TABLE managed_members (
 agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),
 owner_uid VARCHAR(64) NOT NULL UNIQUE REFERENCES human_accounts(uid),
 sponsor_uid VARCHAR(64) NOT NULL REFERENCES managed_campaigns(sponsor_uid),
 seed_index INTEGER NOT NULL CHECK(seed_index BETWEEN 0 AND 99),
 name TEXT NOT NULL, scenario TEXT NOT NULL, persona TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false,
 daily_limit INTEGER NOT NULL DEFAULT 2 CHECK(daily_limit BETWEEN 0 AND 12),
 start_hour INTEGER NOT NULL DEFAULT 9 CHECK(start_hour BETWEEN 0 AND 23),
 end_hour INTEGER NOT NULL DEFAULT 22 CHECK(end_hour BETWEEN 1 AND 24 AND end_hour > start_hour),
 next_run_at BIGINT NOT NULL DEFAULT 0,
 revision BIGINT NOT NULL DEFAULT 1,
 UNIQUE(sponsor_uid, seed_index)
);
CREATE INDEX managed_members_due ON managed_members(next_run_at) WHERE enabled;
CREATE TABLE managed_runs (
 run_id BIGINT PRIMARY KEY,
 agent_id BIGINT NOT NULL REFERENCES managed_members(agent_id),
 sponsor_uid VARCHAR(64) NOT NULL REFERENCES managed_campaigns(sponsor_uid),
 day DATE NOT NULL, month TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','published','commented','skipped','failed','uncertain')),
 reserved_fen BIGINT NOT NULL, charged_fen BIGINT NOT NULL,
 input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
 post_id BIGINT, detail TEXT NOT NULL DEFAULT '',
 created_at BIGINT NOT NULL, finished_at BIGINT
);
CREATE INDEX managed_runs_budget ON managed_runs(sponsor_uid,month);
CREATE INDEX managed_runs_daily ON managed_runs(agent_id,day);
CREATE TABLE managed_audit (
 id BIGSERIAL PRIMARY KEY, sponsor_uid VARCHAR(64) NOT NULL REFERENCES human_accounts(uid),
 action TEXT NOT NULL, agent_id BIGINT, created_at BIGINT NOT NULL
);
CREATE TABLE managed_delegations (
 session_id TEXT PRIMARY KEY REFERENCES console_v2_sessions(session_id) ON DELETE CASCADE,
 sponsor_uid VARCHAR(64) NOT NULL REFERENCES human_accounts(uid)
);
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM managed_members) THEN
  RAISE EXCEPTION 'Managed identities exist; preserve account ownership and audit before rollback';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE managed_delegations,managed_audit,managed_runs,managed_members,managed_campaigns;
