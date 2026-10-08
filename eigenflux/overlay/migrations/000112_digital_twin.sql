-- +goose Up
SET LOCAL lock_timeout = '5s';
-- Human cognition belongs to an owner, independently of runtime credentials.
CREATE TABLE twin_users (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES human_accounts(uid),
    name VARCHAR(80) NOT NULL DEFAULT '',
    basic_info JSONB NOT NULL DEFAULT '{}',
    current_goal TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    last_active_at BIGINT NOT NULL
);
CREATE TABLE twin_persona (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES twin_users(user_id) ON DELETE CASCADE,
    traits JSONB NOT NULL DEFAULT '{}',
    speaking_style TEXT NOT NULL DEFAULT '',
    decision_style TEXT NOT NULL DEFAULT '',
    risk_preference TEXT NOT NULL DEFAULT '',
    social_preference TEXT NOT NULL DEFAULT '',
    updated_at BIGINT NOT NULL
);
CREATE TABLE twin_episodic_memory (
    memory_id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES twin_users(user_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding DOUBLE PRECISION[],
    emotion_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (emotion_score BETWEEN -1 AND 1),
    importance DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
    occurred_at BIGINT,
    decay_rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (decay_rate BETWEEN 0 AND 1),
    access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    source VARCHAR(32) NOT NULL DEFAULT 'human_input',
    created_at BIGINT NOT NULL
);
CREATE INDEX twin_episodic_user_time ON twin_episodic_memory(user_id, occurred_at DESC);
CREATE TABLE twin_semantic_memory (
    memory_id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES twin_users(user_id) ON DELETE CASCADE,
    concept VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    embedding DOUBLE PRECISION[],
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
    source VARCHAR(32) NOT NULL DEFAULT 'human_input',
    updated_at BIGINT NOT NULL
);
CREATE INDEX twin_semantic_user ON twin_semantic_memory(user_id);
-- A private person's label need not be a registered network account.
CREATE TABLE twin_relationships (
    relationship_id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES twin_users(user_id) ON DELETE CASCADE,
    target_id VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    intimacy DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (intimacy BETWEEN 0 AND 1),
    trust DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (trust BETWEEN 0 AND 1),
    emotion DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (emotion BETWEEN -1 AND 1),
    interaction_count INTEGER NOT NULL DEFAULT 0 CHECK (interaction_count >= 0),
    last_interaction_at BIGINT,
    UNIQUE (user_id, target_id)
);
-- Expiring per-agent state avoids mixing simultaneous runtimes' conversations.
CREATE TABLE twin_working_memory (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),
    user_id VARCHAR(64) NOT NULL REFERENCES twin_users(user_id) ON DELETE CASCADE,
    context JSONB NOT NULL DEFAULT '{}',
    current_goal TEXT NOT NULL DEFAULT '',
    active_persona_state JSONB NOT NULL DEFAULT '{}',
    last_updated BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
);
CREATE TABLE twin_agent_policy (
    agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id),
    daily_posts INTEGER NOT NULL DEFAULT 3 CHECK (daily_posts BETWEEN 0 AND 1000),
    daily_searches INTEGER NOT NULL DEFAULT 20 CHECK (daily_searches BETWEEN 0 AND 1000),
    daily_feedback INTEGER NOT NULL DEFAULT 10 CHECK (daily_feedback BETWEEN 0 AND 1000),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL
);
CREATE TABLE twin_daily_usage (
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id),
    day DATE NOT NULL,
    activity VARCHAR(16) NOT NULL CHECK (activity IN ('posts', 'searches', 'feedback')),
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    PRIMARY KEY (agent_id, day, activity)
);
CREATE TABLE twin_agreement_acceptances (
    user_id VARCHAR(64) NOT NULL REFERENCES human_accounts(uid),
    version VARCHAR(40) NOT NULL,
    accepted_at BIGINT NOT NULL,
    PRIMARY KEY(user_id, version)
);
INSERT INTO twin_users(user_id, created_at, last_active_at)
SELECT uid, created_at, created_at FROM human_accounts;
INSERT INTO twin_persona(user_id, updated_at)
SELECT user_id, created_at FROM twin_users;

-- +goose Down
DROP TABLE twin_agreement_acceptances;
DROP TABLE twin_daily_usage;
DROP TABLE twin_agent_policy;
DROP TABLE twin_working_memory;
DROP TABLE twin_relationships;
DROP TABLE twin_semantic_memory;
DROP TABLE twin_episodic_memory;
DROP TABLE twin_persona;
DROP TABLE twin_users;
