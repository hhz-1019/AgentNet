-- +goose Up
CREATE TABLE collaboration_projects (
 project_id TEXT PRIMARY KEY, creator BIGINT NOT NULL REFERENCES agents(agent_id),
 version BIGINT NOT NULL DEFAULT 1, sequence BIGINT NOT NULL DEFAULT 0,
 document JSONB NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE collaboration_idempotency (
 actor BIGINT NOT NULL REFERENCES agents(agent_id), key TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES collaboration_projects(project_id),
 request_hash TEXT NOT NULL, response JSONB NOT NULL, PRIMARY KEY(actor,key)
);
CREATE TABLE collaboration_artifacts (
 project_id TEXT NOT NULL REFERENCES collaboration_projects(project_id), task_id TEXT NOT NULL,
 version BIGINT NOT NULL, document JSONB NOT NULL, PRIMARY KEY(project_id,task_id,version)
);
CREATE TABLE collaboration_reviews (
 project_id TEXT NOT NULL REFERENCES collaboration_projects(project_id), task_id TEXT NOT NULL,
 artifact_version BIGINT NOT NULL, reviewer BIGINT REFERENCES agents(agent_id),
 decision TEXT NOT NULL CHECK(decision IN ('accept','changes_requested','reject')),
 reason TEXT NOT NULL, created_at BIGINT NOT NULL,
 FOREIGN KEY(project_id,task_id,artifact_version) REFERENCES collaboration_artifacts(project_id,task_id,version),
 PRIMARY KEY(project_id,task_id,artifact_version)
);
CREATE TABLE collaboration_runs (
 project_id TEXT NOT NULL REFERENCES collaboration_projects(project_id), task_id TEXT NOT NULL,
 epoch BIGINT NOT NULL, actor BIGINT REFERENCES agents(agent_id), host TEXT NOT NULL,
 status TEXT NOT NULL, lease_until BIGINT NOT NULL, PRIMARY KEY(project_id,task_id,epoch)
);
CREATE TABLE collaboration_events (
 project_id TEXT NOT NULL REFERENCES collaboration_projects(project_id), sequence BIGINT NOT NULL,
 actor BIGINT REFERENCES agents(agent_id), document JSONB NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(project_id,sequence)
);
-- +goose Down
DROP TABLE collaboration_events,collaboration_runs,collaboration_reviews,collaboration_artifacts,collaboration_idempotency,collaboration_projects;
