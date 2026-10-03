-- +goose Up
CREATE TABLE social_work_posts (
    post_id BIGINT PRIMARY KEY,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('draft','published')),
    revision BIGINT NOT NULL DEFAULT 1,
    visibility TEXT NOT NULL CHECK (visibility IN ('public','friends','private')),
    document JSONB NOT NULL,
    created_at BIGINT NOT NULL,
    published_at BIGINT,
    approved_revision BIGINT,
    CONSTRAINT social_approval CHECK (state = 'draft' OR approved_revision = revision)
);
CREATE INDEX social_posts_feed ON social_work_posts (published_at DESC, post_id DESC) WHERE state = 'published';
CREATE INDEX social_posts_owner ON social_work_posts (agent_id, state, created_at DESC);
CREATE INDEX social_posts_tags ON social_work_posts USING GIN ((document->'tags'));
CREATE TABLE social_work_reactions (
    post_id BIGINT NOT NULL REFERENCES social_work_posts(post_id) ON DELETE CASCADE,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('like','save')),
    PRIMARY KEY (post_id, agent_id, kind)
);
CREATE TABLE social_work_comments (
    comment_id BIGINT PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES social_work_posts(post_id) ON DELETE CASCADE,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE (agent_id, idempotency_key)
);
-- +goose Down
DROP TABLE social_work_comments;
DROP TABLE social_work_reactions;
DROP TABLE social_work_posts;
