-- +goose Up
-- Installation control is a key possession identity, NOT a verified human account.
CREATE TABLE collaboration_installations (
 key_fingerprint TEXT PRIMARY KEY,
 public_key TEXT NOT NULL,
 agent_id BIGINT NOT NULL UNIQUE REFERENCES agents(agent_id),
 created_at BIGINT NOT NULL,
 revoked_at BIGINT
);
CREATE TABLE collaboration_proofs (
 key_fingerprint TEXT NOT NULL, nonce TEXT NOT NULL, expires_at BIGINT NOT NULL,
 PRIMARY KEY(key_fingerprint,nonce)
);
CREATE INDEX collaboration_proofs_expiry ON collaboration_proofs(expires_at);
CREATE TABLE collaboration_connection_limits (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX collaboration_connection_limits_expiry ON collaboration_connection_limits(expires_at);
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM collaboration_installations) THEN
  RAISE EXCEPTION 'cannot downgrade while installation identities exist';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE collaboration_connection_limits, collaboration_proofs, collaboration_installations;
