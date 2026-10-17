-- +goose Up
CREATE TABLE managed_public_events (
 sponsor_uid TEXT NOT NULL,
 source_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 observed_at BIGINT NOT NULL,
 PRIMARY KEY(sponsor_uid,source_key,fingerprint),
 FOREIGN KEY(sponsor_uid,source_key) REFERENCES managed_public_sources(sponsor_uid,source_key) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE managed_public_events;
