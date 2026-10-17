-- +goose Up
-- Normalize exact legacy identity copy on current managed profiles only.
-- Ownership, authorization, posts, source evidence and historical revisions stay intact.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION pg_temp.operator_identity_copy(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF value = 'platform_test' THEN RETURN 'platform_operator'; END IF;
  IF value = 'fictional_character' THEN RETURN 'operator_agent'; END IF;
  value := regexp_replace(value, 'elsewhere 创建的([^。]+)模拟代理，非本人，未获本人授权。关注', '关注\1公开动态的 Agent，由账号运营者管理。关注', 'g');
  value := regexp_replace(value, 'elsewhere 整理的([^；]+)官网招聘信息；非企业官方账号，未代表企业授权。', '整理\1官网招聘信息的 Agent，由账号运营者管理。', 'g');
  value := replace(value, 'elsewhere 官方运营；不是公众人物本人账号。', '本账号运营者');
  value := replace(value, 'elsewhere 平台维护的企业公开招聘信息。', '本账号运营者');
  value := replace(value, '公开招聘信息画像，由 elsewhere 整理；未代表企业入驻或授权。', '公开招聘信息 Agent，由账号运营者管理。');
  value := replace(value, '公开人物身份补充：你是 elsewhere 为该人物设置的模拟代理，有自己的性格；', '公开人物身份补充：你是由账号运营者管理、关注该人物公开动态的 Agent，有自己的性格；');
  value := replace(value, '主页保留模拟身份，别人询问时如实回答。', '别人询问身份时，按实际账号归属如实回答。');
  value := replace(value, '本测试账号的运营者', '本账号运营者');
  value := replace(value, 'AI 虚构角色，', 'AI Agent，由账号运营者管理。性格设定：');
  value := replace(value, '没有企业授权，不以企业 HR 身份承诺招聘', '招聘承诺须有企业的明确授权');
  value := replace(value, '日常不主动说“我是虚拟的”“我是虚构角色”“作为 AI”；被直接问及身份时，简短如实说明是 Agent，然后回应对方真正关心的问题。', '直接参与具体交流；被问及身份时，按实际账号归属简短回答，然后回应对方关心的问题。');
  RETURN regexp_replace(value, ' · 模拟代理$', ' · 资讯 Agent');
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION pg_temp.operator_identity_json(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb;
BEGIN
  CASE jsonb_typeof(value)
  WHEN 'string' THEN RETURN to_jsonb(pg_temp.operator_identity_copy(value #>> '{}'));
  WHEN 'object' THEN
    SELECT jsonb_object_agg(key, pg_temp.operator_identity_json(val)) INTO result FROM jsonb_each(value) AS e(key,val);
    RETURN COALESCE(result, '{}'::jsonb);
  WHEN 'array' THEN
    SELECT jsonb_agg(pg_temp.operator_identity_json(val) ORDER BY pos) INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val,pos);
    RETURN COALESCE(result, '[]'::jsonb);
  ELSE RETURN value;
  END CASE;
END;
$$;
-- +goose StatementEnd

UPDATE managed_members SET name=pg_temp.operator_identity_copy(name), persona=pg_temp.operator_identity_copy(persona)
WHERE name IS DISTINCT FROM pg_temp.operator_identity_copy(name) OR persona IS DISTINCT FROM pg_temp.operator_identity_copy(persona);

UPDATE agents a SET agent_name=pg_temp.operator_identity_copy(a.agent_name), bio=pg_temp.operator_identity_copy(a.bio), updated_at=(extract(epoch FROM now())*1000)::bigint
FROM managed_members m WHERE a.agent_id=m.agent_id
AND (a.agent_name IS DISTINCT FROM pg_temp.operator_identity_copy(a.agent_name) OR a.bio IS DISTINCT FROM pg_temp.operator_identity_copy(a.bio));

UPDATE twin_users t SET portrait_fields=pg_temp.operator_identity_json(t.portrait_fields), portrait_revision=portrait_revision+1, portrait_last_write_hash=''
FROM managed_members m WHERE t.user_id=m.owner_uid AND t.portrait_fields IS DISTINCT FROM pg_temp.operator_identity_json(t.portrait_fields);

UPDATE agent_onboarding_drafts d SET draft_data=pg_temp.operator_identity_json(d.draft_data)
FROM managed_members m WHERE d.agent_id=m.agent_id
AND d.revision=(SELECT max(latest.revision) FROM agent_onboarding_drafts latest WHERE latest.agent_id=d.agent_id)
AND d.draft_data IS DISTINCT FROM pg_temp.operator_identity_json(d.draft_data);

UPDATE agent_context_revisions r SET compiled_context=pg_temp.operator_identity_json(r.compiled_context)
FROM managed_members m, agent_context_heads h WHERE r.agent_id=m.agent_id AND h.agent_id=m.agent_id AND r.revision=h.active_revision
AND r.compiled_context IS DISTINCT FROM pg_temp.operator_identity_json(r.compiled_context);

UPDATE agent_cards c SET public_card=pg_temp.operator_identity_json(c.public_card),
rebuild_fence=nextval('agent_card_rebuild_fence_seq'), card_version=card_version+1, public_card_version=public_card_version+1,
generated_at=(extract(epoch FROM now())*1000)::bigint, public_card_generated_at=(extract(epoch FROM now())*1000)::bigint
FROM managed_members m WHERE c.agent_id=m.agent_id AND c.public_card IS DISTINCT FROM pg_temp.operator_identity_json(c.public_card);

-- +goose Down
-- Do not restore obsolete labels or overwrite subsequent operator edits.
SELECT 1;
