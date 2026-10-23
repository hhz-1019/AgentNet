-- +goose NO TRANSACTION
-- +goose Up
-- Feed counts and comment pages filter by post_id. The primary key alone
-- indexes comment_id, forcing repeated scans as the comment table grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS social_comments_post_page
    ON social_work_comments(post_id, comment_id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS social_group_members_agent
    ON social_group_members(agent_id, group_id);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS social_group_members_agent;
DROP INDEX CONCURRENTLY IF EXISTS social_comments_post_page;
