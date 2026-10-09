-- +goose Up
SET LOCAL lock_timeout = '5s';
CREATE TABLE owner_uid_batches (
    name TEXT PRIMARY KEY,
    digits INTEGER NOT NULL CHECK (digits BETWEEN 5 AND 11),
    quota BIGINT NOT NULL CHECK (quota > 0 AND quota <= 9 * power(10::numeric,digits-1)),
    issued BIGINT NOT NULL DEFAULT 0 CHECK (issued >= 0 AND issued <= quota),
    active BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX owner_uid_one_active_batch ON owner_uid_batches(active) WHERE active;
INSERT INTO owner_uid_batches(name,digits,quota,active) VALUES('founding-5',5,10000,true);

-- This ledger deliberately has no owner FK: deletion must never recycle a UID.
CREATE TABLE owner_uid_numbers (
    number BIGINT PRIMARY KEY CHECK (number BETWEEN 10000 AND 99999999999),
    source TEXT NOT NULL CHECK (source IN ('legacy','public','operator')),
    batch_name TEXT REFERENCES owner_uid_batches(name),
    reserved_agent_id BIGINT UNIQUE,
    owner_uid VARCHAR(64) UNIQUE,
    registered BOOLEAN NOT NULL DEFAULT false,
    created_at BIGINT NOT NULL,
    CHECK (NOT registered OR owner_uid IS NOT NULL)
);
INSERT INTO owner_uid_numbers(number,source,owner_uid,registered,created_at)
SELECT account_number,'legacy',uid,true,created_at FROM human_accounts;
CREATE TABLE owner_uid_admin_events (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    detail JSONB NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

-- Capture all account writers, including maintenance imports. Allocation and
-- registration commit together; an issued/deleted account can never be recreated.
-- +goose StatementBegin
CREATE FUNCTION guard_owner_uid_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.account_number IS DISTINCT FROM OLD.account_number OR NEW.uid IS DISTINCT FROM OLD.uid THEN
            RAISE EXCEPTION 'Issued owner UIDs are immutable';
        END IF;
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(734817611);
    INSERT INTO owner_uid_numbers(number,source,owner_uid,registered,created_at)
    VALUES(NEW.account_number,'legacy',NEW.uid,true,NEW.created_at)
    ON CONFLICT(number) DO UPDATE SET registered=true
    WHERE owner_uid_numbers.owner_uid=NEW.uid AND NOT owner_uid_numbers.registered;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'UID is reserved or previously issued' USING ERRCODE='23505';
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER human_account_uid_guard BEFORE INSERT OR UPDATE OF account_number,uid ON human_accounts
FOR EACH ROW EXECUTE FUNCTION guard_owner_uid_number();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM owner_uid_numbers WHERE source <> 'legacy') OR EXISTS(SELECT 1 FROM owner_uid_admin_events) THEN
        RAISE EXCEPTION 'UID batch history exists; preserve reservations and issuance ledger before rollback';
    END IF;
END $$;
-- +goose StatementEnd
DROP TRIGGER human_account_uid_guard ON human_accounts;
DROP FUNCTION guard_owner_uid_number();
DROP TABLE owner_uid_admin_events;
DROP TABLE owner_uid_numbers;
DROP TABLE owner_uid_batches;
