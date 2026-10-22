-- +goose Up
-- Only a keyed digest of (old Agent ID, key fingerprint) survives erasure.
-- No foreign key: offline hosts must still confirm deletion after source rows
-- and the external-erasure job have gone. A reused key/new ID cannot match.
CREATE TABLE agent_account_deletions (
    proof_hash VARCHAR(64) PRIMARY KEY,
    deleted_at BIGINT NOT NULL
);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM agent_account_deletions) THEN
        RAISE EXCEPTION 'Keep account deletion proofs for offline hosts';
    END IF;
END $$;
-- +goose StatementEnd
DROP TABLE agent_account_deletions;
