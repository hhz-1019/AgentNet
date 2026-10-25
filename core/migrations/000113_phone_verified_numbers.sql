-- +goose Up
SET LOCAL lock_timeout = '5s';
CREATE SEQUENCE human_account_number_seq AS BIGINT MINVALUE 10000 START WITH 10000 NO CYCLE;
ALTER TABLE human_accounts ADD COLUMN account_number BIGINT;
-- Keep opaque internal keys and all foreign keys stable. Public numbers are ordered
-- by original creation time for existing owners; new numbers are allocated atomically.
WITH ordered AS (
 SELECT uid, 9999 + row_number() OVER (ORDER BY created_at, uid) AS number FROM human_accounts
)
UPDATE human_accounts a SET account_number=o.number FROM ordered o WHERE a.uid=o.uid;
SELECT setval('human_account_number_seq', GREATEST(COALESCE((SELECT MAX(account_number) FROM human_accounts),9999)+1,10000), false);
ALTER TABLE human_accounts ALTER COLUMN account_number SET DEFAULT nextval('human_account_number_seq');
ALTER TABLE human_accounts ALTER COLUMN account_number SET NOT NULL;
ALTER TABLE human_accounts ADD CONSTRAINT human_account_number_unique UNIQUE(account_number);
ALTER TABLE human_accounts ADD CONSTRAINT human_account_number_valid CHECK(account_number >= 10000);
ALTER SEQUENCE human_account_number_seq OWNED BY human_accounts.account_number;
ALTER TABLE human_accounts ADD COLUMN phone_hash VARCHAR(128);
ALTER TABLE human_accounts ADD COLUMN phone_last4 VARCHAR(4);
ALTER TABLE human_accounts ADD COLUMN phone_verified_at BIGINT;
CREATE UNIQUE INDEX human_accounts_one_phone ON human_accounts(phone_hash) WHERE phone_hash IS NOT NULL;
ALTER TABLE human_accounts ADD CONSTRAINT human_phone_binding_valid CHECK (
 (phone_hash IS NULL AND phone_last4 IS NULL AND phone_verified_at IS NULL) OR
 (phone_hash IS NOT NULL AND phone_last4 IS NOT NULL AND phone_last4 ~ '^[0-9]{4}$' AND phone_verified_at IS NOT NULL)
);
CREATE TABLE human_phone_challenges (
 challenge_id VARCHAR(64) PRIMARY KEY,
 phone_hash VARCHAR(128) NOT NULL,
 otp_hash VARCHAR(128) NOT NULL,
 session_id VARCHAR(128) NOT NULL,
 purpose VARCHAR(16) NOT NULL CHECK(purpose IN ('register','bind')),
 delivery_state VARCHAR(16) NOT NULL CHECK(delivery_state IN ('pending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_at BIGINT NOT NULL,
 expires_at BIGINT NOT NULL,
 consumed_at BIGINT
);
CREATE INDEX human_phone_challenges_expiry ON human_phone_challenges(expires_at);
CREATE INDEX human_phone_challenges_phone_session ON human_phone_challenges(phone_hash,session_id,purpose);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM human_accounts WHERE phone_hash IS NOT NULL) THEN
  RAISE EXCEPTION 'Verified phone bindings exist; plan an explicit migration before rollback';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE human_phone_challenges;
ALTER TABLE human_accounts DROP CONSTRAINT human_phone_binding_valid;
DROP INDEX human_accounts_one_phone;
ALTER TABLE human_accounts DROP COLUMN phone_hash, DROP COLUMN phone_last4, DROP COLUMN phone_verified_at;
ALTER TABLE human_accounts DROP COLUMN account_number;
