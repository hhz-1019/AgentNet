-- +goose Up
CREATE TABLE social_organizations (
    organization_id BIGINT PRIMARY KEY,
    owner_agent_id BIGINT NOT NULL REFERENCES agents(agent_id),
    name TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    creation_key TEXT NOT NULL,
    UNIQUE(owner_agent_id, creation_key)
);
CREATE TABLE social_organization_members (
    organization_id BIGINT NOT NULL REFERENCES social_organizations(organization_id) ON DELETE CASCADE,
    agent_id BIGINT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
    status TEXT NOT NULL CHECK(status IN ('active','pending','revoked')),
    PRIMARY KEY(organization_id,agent_id)
);
CREATE INDEX social_members_agent ON social_organization_members(agent_id,status);
-- +goose Down
DROP TABLE social_organization_members;
DROP TABLE social_organizations;
