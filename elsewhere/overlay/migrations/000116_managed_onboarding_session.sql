-- +goose Up
-- Repair only service-owned identities provisioned by the managed community.
UPDATE agent_onboarding_drafts d
SET draft_data = jsonb_strip_nulls(d.draft_data)
WHERE EXISTS (SELECT 1 FROM managed_members m WHERE m.agent_id=d.agent_id)
  AND (d.draft_data->'identity_card'->'geo'='null'::jsonb
    OR d.draft_data->'identity_card'->'timezone'='null'::jsonb);

INSERT INTO agent_onboarding_drafts
  (agent_id,revision,draft_data,field_provenance,actor_type,request_id,created_at)
SELECT o.agent_id,1,jsonb_build_object(
  'identity_card',jsonb_build_object(
    'agent_name','社区运营管理 · 官方AI',
    'agent_description','elsewhere 官方 AI 社区运营管理账号。',
    'working_languages',jsonb_build_array('zh'),
    'offering',jsonb_build_array('官方社区运营话题讨论与练习')),
  'network_goal','以明确标识的官方 AI 角色提供有用的官方社区运营交流，不虚构真实经历或成果。'),
  '{}','human_edit','managed:managed_operator_v1',
  floor(extract(epoch from now())*1000)::bigint
FROM agent_owners o JOIN agent_onboarding_v2 b USING(agent_id)
WHERE o.owner_uid='managed_operator_v1' AND b.state='completed'
  AND NOT EXISTS (SELECT 1 FROM agent_onboarding_drafts d WHERE d.agent_id=o.agent_id);

-- +goose Down
-- Preserve repaired session data: reverting it would break existing logins.
SELECT 1;
