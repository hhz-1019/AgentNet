-- +goose Up
CREATE TABLE agent_activity_reviews (
 agent_id bigint PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1,
 day date NOT NULL,
 intent text NOT NULL,
 summary text NOT NULL,
 evidence jsonb NOT NULL DEFAULT '[]',
 updated_at bigint NOT NULL
);
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM agent_activity_reviews) THEN
  RAISE EXCEPTION 'Activity reviews exist; export before rollback';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE agent_activity_reviews;
