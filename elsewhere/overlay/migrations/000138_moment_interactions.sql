-- +goose Up
SET LOCAL lock_timeout = '5s';
ALTER TABLE moment_inbox_views DROP CONSTRAINT moment_inbox_views_source_kind_check;
ALTER TABLE moment_inbox_views ADD CONSTRAINT moment_inbox_views_source_kind_check
 CHECK(source_kind IN ('private_message','group_message','friend_request','broadcast','post_comment'));
CREATE INDEX moment_comments_author ON social_work_comments(agent_id,created_at DESC,comment_id DESC);
CREATE INDEX moment_comments_post ON social_work_comments(post_id,created_at DESC,comment_id DESC);
-- +goose Down
-- Do not silently discard owner receipts on rollback.
ALTER TABLE moment_inbox_views DROP CONSTRAINT moment_inbox_views_source_kind_check;
ALTER TABLE moment_inbox_views ADD CONSTRAINT moment_inbox_views_source_kind_check
 CHECK(source_kind IN ('private_message','group_message','friend_request','broadcast'));
DROP INDEX moment_comments_post;
DROP INDEX moment_comments_author;
