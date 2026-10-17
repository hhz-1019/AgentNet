-- +goose Up
-- Keep counts atomic with reactions, including deletes and cascading account removal.
LOCK TABLE social_work_reactions IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE social_work_posts ADD COLUMN like_count BIGINT NOT NULL DEFAULT 0, ADD COLUMN save_count BIGINT NOT NULL DEFAULT 0;
UPDATE social_work_posts p SET like_count=(SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='like'),save_count=(SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='save');
-- +goose StatementBegin
CREATE FUNCTION social_reaction_counts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN UPDATE social_work_posts SET like_count=0,save_count=0; RETURN NULL; END IF;
 IF TG_OP IN ('DELETE','UPDATE') THEN
  UPDATE social_work_posts SET like_count=like_count-CASE WHEN OLD.kind='like' THEN 1 ELSE 0 END,save_count=save_count-CASE WHEN OLD.kind='save' THEN 1 ELSE 0 END WHERE post_id=OLD.post_id;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  UPDATE social_work_posts SET like_count=like_count+CASE WHEN NEW.kind='like' THEN 1 ELSE 0 END,save_count=save_count+CASE WHEN NEW.kind='save' THEN 1 ELSE 0 END WHERE post_id=NEW.post_id;
 END IF;
 RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER social_reaction_counts AFTER INSERT OR UPDATE OR DELETE ON social_work_reactions FOR EACH ROW EXECUTE FUNCTION social_reaction_counts();
CREATE TRIGGER social_reaction_counts_reset AFTER TRUNCATE ON social_work_reactions FOR EACH STATEMENT EXECUTE FUNCTION social_reaction_counts();
CREATE INDEX social_public_popular ON social_work_posts(like_count DESC,post_id DESC) WHERE state='published' AND visibility='public';
CREATE INDEX social_public_latest ON social_work_posts(post_id DESC) WHERE state='published' AND visibility='public';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX social_post_title_search ON social_work_posts USING GIN ((document->>'title') gin_trgm_ops);
CREATE INDEX social_post_summary_search ON social_work_posts USING GIN ((document->>'summary') gin_trgm_ops);
CREATE INDEX social_post_body_search ON social_work_posts USING GIN ((document->>'body') gin_trgm_ops);
-- +goose Down
DROP INDEX social_post_body_search;
DROP INDEX social_post_summary_search;
DROP INDEX social_post_title_search;
DROP INDEX social_public_latest;
DROP INDEX social_public_popular;
DROP TRIGGER social_reaction_counts_reset ON social_work_reactions;
DROP TRIGGER social_reaction_counts ON social_work_reactions;
DROP FUNCTION social_reaction_counts();
ALTER TABLE social_work_posts DROP COLUMN like_count,DROP COLUMN save_count;
