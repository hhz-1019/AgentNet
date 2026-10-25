-- +goose Up
CREATE TABLE analytics_registration_collection (
 id INTEGER PRIMARY KEY CHECK(id=1), started_at BIGINT NOT NULL
);
INSERT INTO analytics_registration_collection VALUES(1,(extract(epoch FROM clock_timestamp())*1000)::bigint);
-- One registration journey per provisioned Agent, not per browser tab or keystroke.
-- No phone, password, verification code, IP, user agent or form value is stored.
CREATE TABLE analytics_registration_journeys (
 agent_id BIGINT PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source IN ('observed','legacy')),
 started_at BIGINT NOT NULL,
 last_seen_at BIGINT,
 sms_at BIGINT,
 submitted_at BIGINT,
 profile_at BIGINT,
 last_input TEXT NOT NULL DEFAULT 'form',
 error_code TEXT,
 error_stage TEXT,
 error_at BIGINT
);
CREATE INDEX registration_started ON analytics_registration_journeys(source,started_at);
-- Historical state is a separate snapshot, never invented past form events.
INSERT INTO analytics_registration_journeys(agent_id,source,started_at,last_input)
 SELECT n.agent_id,'legacy',n.created_at,'unknown'
 FROM agent_onboarding_v2 n JOIN agents a USING(agent_id)
 WHERE n.state<>'completed' AND NOT a.is_official
 AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=n.agent_id);
-- +goose Down
DROP TABLE IF EXISTS analytics_registration_journeys;
DROP TABLE IF EXISTS analytics_registration_collection;
