-- +goose Up
SET LOCAL lock_timeout = '5s';
CREATE TABLE human_accounts (
    uid VARCHAR(64) PRIMARY KEY,
    password_hash TEXT NOT NULL,
    recovery_hash VARCHAR(128) NOT NULL,
    created_at BIGINT NOT NULL
);
-- The stable owner key also permits future phone credentials without changing Agent IDs.
CREATE TABLE agent_owners (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),
    owner_uid VARCHAR(64) NOT NULL REFERENCES human_accounts(uid),
    created_at BIGINT NOT NULL
);
CREATE INDEX agent_owners_uid ON agent_owners(owner_uid);
ALTER TABLE console_v2_sessions ADD COLUMN owner_uid VARCHAR(64) REFERENCES human_accounts(uid);
ALTER TABLE console_v2_sessions DROP CONSTRAINT chk_console_v2_sessions_auth_method;
ALTER TABLE console_v2_sessions ADD CONSTRAINT chk_console_v2_sessions_auth_method
    CHECK (auth_method IN ('handoff', 'email_otp', 'uid_password'));
ALTER TABLE agent_principals DROP CONSTRAINT chk_agent_principals_key_type;
ALTER TABLE agent_principals ADD CONSTRAINT chk_agent_principals_key_type
    CHECK (key_type IN ('ed25519-v1', 'email-recovery-v1', 'uid-browser-v1'));

-- +goose Down
-- Never silently discard owners or their recovery credentials.
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM human_accounts) THEN
        RAISE EXCEPTION 'UID accounts exist; export and plan account migration before rollback';
    END IF;
END $$;
-- +goose StatementEnd
DELETE FROM console_v2_sessions WHERE auth_method = 'uid_password';
ALTER TABLE console_v2_sessions DROP COLUMN owner_uid;
ALTER TABLE console_v2_sessions DROP CONSTRAINT chk_console_v2_sessions_auth_method;
ALTER TABLE console_v2_sessions ADD CONSTRAINT chk_console_v2_sessions_auth_method CHECK (auth_method IN ('handoff', 'email_otp'));
ALTER TABLE agent_principals DROP CONSTRAINT chk_agent_principals_key_type;
ALTER TABLE agent_principals ADD CONSTRAINT chk_agent_principals_key_type CHECK (key_type IN ('ed25519-v1', 'email-recovery-v1'));
DROP TABLE agent_owners;
DROP TABLE human_accounts;
