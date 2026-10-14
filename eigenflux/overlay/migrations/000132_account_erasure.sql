-- +goose Up
-- Opaque IDs only: no password, phone, profile, or message content in the queue.
CREATE TABLE account_erasure_jobs (
    job_id VARCHAR(64) PRIMARY KEY,
    agent_ids BIGINT[] NOT NULL,
    item_ids BIGINT[] NOT NULL,
    redis_keys TEXT[] NOT NULL DEFAULT '{}',
    created_at BIGINT NOT NULL,
    next_attempt_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    completed_at BIGINT
);
CREATE INDEX account_erasure_pending ON account_erasure_jobs(next_attempt_at) WHERE completed_at IS NULL;
CREATE TABLE erased_agent_ids (agent_id BIGINT PRIMARY KEY);
CREATE TABLE erased_owner_ids (owner_uid VARCHAR(64) PRIMARY KEY);
CREATE TABLE erased_item_ids (item_id BIGINT PRIMARY KEY);

-- Guard in-flight queue consumers after the account's source rows are erased.
-- +goose StatementBegin
CREATE FUNCTION reject_erased_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(NEW.item_id);
 IF EXISTS(SELECT 1 FROM erased_item_ids WHERE item_id=NEW.item_id) THEN
  RAISE EXCEPTION 'Content belongs to an erased account' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER reject_erased_processed_item BEFORE INSERT OR UPDATE ON processed_items
 FOR EACH ROW EXECUTE FUNCTION reject_erased_content();
-- +goose StatementBegin
CREATE FUNCTION reject_erased_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(NEW.author_agent_id);
 IF EXISTS(SELECT 1 FROM erased_agent_ids WHERE agent_id=NEW.author_agent_id) THEN
  RAISE EXCEPTION 'Author account has been erased' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER reject_erased_raw_item BEFORE INSERT OR UPDATE ON raw_items
 FOR EACH ROW EXECUTE FUNCTION reject_erased_author();


-- Fence non-FK projections and in-flight requests as well as source tables.
-- +goose StatementBegin
CREATE FUNCTION reject_erased_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; value text; doc jsonb := to_jsonb(NEW);
BEGIN
 FOREACH key IN ARRAY TG_ARGV LOOP
  value := doc->>key;
  IF value IS NULL OR value='' THEN CONTINUE; END IF;
  IF key IN ('owner_uid','user_id','sponsor_uid') OR (TG_TABLE_NAME='human_accounts' AND key='uid') THEN
   PERFORM pg_advisory_xact_lock_shared(hashtextextended('account-erasure:'||value,0));
   IF EXISTS(SELECT 1 FROM erased_owner_ids WHERE owner_uid=value) THEN
    RAISE EXCEPTION 'Owner account has been erased' USING ERRCODE='23514';
   END IF;
  ELSE
   PERFORM pg_advisory_xact_lock_shared(value::bigint);
   IF EXISTS(SELECT 1 FROM erased_agent_ids WHERE agent_id=value::bigint) THEN
    RAISE EXCEPTION 'Agent account has been erased' USING ERRCODE='23514';
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.table_name,string_agg(quote_literal(c.column_name),',' ORDER BY c.column_name) AS args
 FROM information_schema.columns c JOIN information_schema.tables t USING(table_catalog,table_schema,table_name)
 WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
 AND c.table_name NOT IN ('erased_agent_ids','erased_owner_ids','erased_item_ids','owner_uid_numbers')
 AND (c.column_name IN ('agent_id','author_agent_id','subject_agent_id','source_agent_id','target_agent_id','actor_agent_id','sender_id','receiver_id','from_uid','to_uid','follower_id','followed_id','participant_a','participant_b','consumed_by_agent_id','owner_uid','user_id','sponsor_uid') OR (c.table_name='human_accounts' AND c.column_name='uid'))
 GROUP BY c.table_name LOOP
  EXECUTE format('CREATE TRIGGER account_erasure_fence BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION reject_erased_identity(%s)',r.table_name,r.args);
 END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM erased_agent_ids) THEN
  RAISE EXCEPTION 'Erased-account fences must be retained';
 END IF;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tgrelid::regclass AS name FROM pg_trigger WHERE tgname='account_erasure_fence' LOOP
  EXECUTE format('DROP TRIGGER account_erasure_fence ON %s',r.name);
 END LOOP;
END $$;
-- +goose StatementEnd
DROP FUNCTION reject_erased_identity();
DROP TABLE erased_owner_ids;
DROP TRIGGER reject_erased_raw_item ON raw_items;
DROP TRIGGER reject_erased_processed_item ON processed_items;
DROP FUNCTION reject_erased_author();
DROP FUNCTION reject_erased_content();
DROP TABLE erased_item_ids;
DROP TABLE erased_agent_ids;
DROP TABLE account_erasure_jobs;
