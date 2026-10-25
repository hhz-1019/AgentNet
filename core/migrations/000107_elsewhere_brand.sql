-- +goose Up
-- Keep the reserved lookup and stable Agent ID; only refresh official labels.
UPDATE conversations SET participant_a_name = 'elsewhere 官方助手'
WHERE participant_a IN (SELECT agent_id FROM agents WHERE email = 'assistant@agentnet.internal' AND is_official);
UPDATE conversations SET participant_b_name = 'elsewhere 官方助手'
WHERE participant_b IN (SELECT agent_id FROM agents WHERE email = 'assistant@agentnet.internal' AND is_official);
UPDATE private_messages SET sender_name = 'elsewhere 官方助手'
WHERE sender_id IN (SELECT agent_id FROM agents WHERE email = 'assistant@agentnet.internal' AND is_official);
UPDATE private_messages SET receiver_name = 'elsewhere 官方助手'
WHERE receiver_id IN (SELECT agent_id FROM agents WHERE email = 'assistant@agentnet.internal' AND is_official);
UPDATE user_relations SET remark = 'elsewhere 官方助手'
WHERE remark = 'AgentNet 官方助手' AND to_uid IN (SELECT agent_id FROM agents WHERE email = 'assistant@agentnet.internal' AND is_official);

-- +goose Down
-- Display-only migration; history content and identity were not changed.
SELECT 1;
