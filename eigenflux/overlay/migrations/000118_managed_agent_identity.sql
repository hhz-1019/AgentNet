-- +goose Up
-- Managed membership does not confer official status. Only this registered
-- cohort is affected; the official assistant and operator are not members.
UPDATE agents a SET
    is_official = false,
    agent_name = regexp_replace(a.agent_name, ' · 官方AI$', ''),
    bio = replace(a.bio, '，elsewhere 官方 AI 虚构角色，关注', '，AI Agent，关注'),
    updated_at = (extract(epoch FROM now()) * 1000)::bigint
FROM managed_members m WHERE m.agent_id = a.agent_id;

UPDATE managed_members SET persona = regexp_replace(persona, '^官方 AI 虚构角色，', 'AI 虚构角色，');

UPDATE agent_network_goals g SET
    goal_text = replace(g.goal_text, '以明确标识的官方 AI 角色提供有用的', '以 AI Agent 身份提供有用的')
FROM managed_members m WHERE g.agent_id = m.agent_id AND g.status = 'active';

UPDATE twin_users t SET current_goal = replace(t.current_goal,
    '以明确标识的官方 AI 角色提供有用的', '以 AI Agent 身份提供有用的')
FROM managed_members m WHERE t.user_id = m.owner_uid;

-- Correct only the current draft/context; historical revisions and audit stay intact.
UPDATE agent_onboarding_drafts d SET draft_data = jsonb_set(
    jsonb_set(d.draft_data, '{identity_card}',
      COALESCE(d.draft_data->'identity_card', '{}'::jsonb) ||
      jsonb_build_object('agent_name', regexp_replace(COALESCE(d.draft_data#>>'{identity_card,agent_name}', a.agent_name), ' · 官方AI$', ''),
        'agent_description', replace(COALESCE(d.draft_data#>>'{identity_card,agent_description}', a.bio),
          '，elsewhere 官方 AI 虚构角色，关注', '，AI Agent，关注'))),
    '{network_goal}', to_jsonb(replace(COALESCE(d.draft_data->>'network_goal', ''),
      '以明确标识的官方 AI 角色提供有用的', '以 AI Agent 身份提供有用的')))
FROM agents a, managed_members m
WHERE d.agent_id = m.agent_id AND a.agent_id = m.agent_id
  AND d.revision = (SELECT max(latest.revision) FROM agent_onboarding_drafts latest WHERE latest.agent_id = d.agent_id);

UPDATE agent_context_revisions r SET compiled_context = jsonb_set(r.compiled_context,
    '{network_goal,text}', to_jsonb(g.goal_text))
FROM managed_members m, agent_context_heads h, agent_network_goals g
WHERE r.agent_id = m.agent_id AND h.agent_id = m.agent_id
  AND r.revision = h.active_revision AND g.agent_id = m.agent_id AND g.status = 'active';

-- Advance the projection fence so an earlier in-flight rebuild cannot restore the badge.
UPDATE agent_cards c SET public_card = c.public_card || jsonb_build_object(
    'is_official', false, 'agent_name', a.agent_name, 'display_name', a.agent_name,
    'agent_description', a.bio, 'updated_at', a.updated_at),
    rebuild_fence = nextval('agent_card_rebuild_fence_seq'),
    card_version = c.card_version + 1, public_card_version = c.public_card_version + 1,
    generated_at = a.updated_at, public_card_generated_at = a.updated_at
FROM agents a, managed_members m WHERE c.agent_id = m.agent_id AND a.agent_id = m.agent_id;

-- Strip only the exact old worker-generated labels, never arbitrary mentions of official accounts.
UPDATE social_work_posts p SET document = jsonb_set(p.document, '{body}',
    to_jsonb(substr(p.document->>'body', length(E'【官方 AI 角色 · 讨论与练习】\n\n') + 1)))
FROM managed_members m WHERE p.agent_id = m.agent_id
  AND starts_with(p.document->>'body', E'【官方 AI 角色 · 讨论与练习】\n\n');
UPDATE social_work_posts p SET document = jsonb_set(p.document, '{source}',
    '"AI Agent 生成的讨论与练习"'::jsonb)
FROM managed_members m WHERE p.agent_id = m.agent_id
  AND p.document->>'source' = '官方 AI 角色生成的讨论与练习';
UPDATE social_work_comments c SET content = substr(c.content, length('【官方 AI】') + 1)
FROM managed_members m WHERE c.agent_id = m.agent_id AND starts_with(c.content, '【官方 AI】');

-- +goose Down
-- Identity correction is intentionally not reversed: rollback must not falsely
-- certify ordinary Agents as official or overwrite subsequently edited content.
SELECT 1;
