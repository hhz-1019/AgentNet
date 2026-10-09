-- +goose Up
SET LOCAL lock_timeout = '5s';
ALTER TABLE twin_users ADD COLUMN portrait_fields JSONB NOT NULL DEFAULT '{}', ADD COLUMN portrait_visible JSONB NOT NULL DEFAULT '["name","bio","interests"]', ADD COLUMN portrait_revision BIGINT NOT NULL DEFAULT 0, ADD COLUMN portrait_last_write_hash TEXT NOT NULL DEFAULT '', ADD COLUMN portrait_human_fields JSONB NOT NULL DEFAULT '[]';
UPDATE twin_users SET portrait_fields=jsonb_build_object('name',name,'bio','','interests',COALESCE(basic_info->>'interests',''),'role',COALESCE(basic_info->>'role',''),'values','','recent',current_goal);
CREATE TABLE portrait_memories (
 user_id VARCHAR(64) NOT NULL REFERENCES twin_users(user_id) ON DELETE CASCADE, memory_id UUID NOT NULL,
 content TEXT NOT NULL, show_on_home BOOLEAN NOT NULL DEFAULT false,
 edited_by TEXT NOT NULL DEFAULT 'agent' CHECK(edited_by IN ('human','agent')),
 created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,memory_id)
);
CREATE INDEX portrait_memories_page ON portrait_memories(user_id,created_at DESC,memory_id DESC) WHERE NOT deleted;
INSERT INTO portrait_memories(user_id,memory_id,content,created_at,updated_at)
 SELECT user_id,memory_id,content || E'\n情绪：' || emotion_score || '；重要程度：' || importance || COALESCE('；发生时间：' || occurred_at,'') ,created_at,created_at FROM twin_episodic_memory;
INSERT INTO portrait_memories(user_id,memory_id,content,created_at,updated_at)
 SELECT user_id,memory_id,concept || E'\n' || description || E'\n置信度：' || confidence,updated_at,updated_at FROM twin_semantic_memory ON CONFLICT DO NOTHING;
INSERT INTO portrait_memories(user_id,memory_id,content,created_at,updated_at)
 SELECT user_id,relationship_id,target_id || E'\n' || description || E'\n亲密度：' || intimacy || '；信任度：' || trust || '；情绪：' || emotion,COALESCE(last_interaction_at,0),COALESCE(last_interaction_at,0) FROM twin_relationships ON CONFLICT DO NOTHING;
ALTER TABLE social_media DROP CONSTRAINT social_media_content_type_check;
ALTER TABLE social_media ADD CONSTRAINT social_media_content_type_check CHECK(content_type IN ('image/png','image/jpeg','video/mp4','video/webm'));
CREATE TABLE social_follows (
 follower_id BIGINT NOT NULL REFERENCES agents(agent_id), followed_id BIGINT NOT NULL REFERENCES agents(agent_id),
 PRIMARY KEY(follower_id,followed_id), CHECK(follower_id<>followed_id)
);
CREATE TABLE social_web_operations (
 agent_id BIGINT NOT NULL REFERENCES agents(agent_id), idempotency_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL, resource_id BIGINT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(agent_id,idempotency_key)
);
ALTER TABLE private_messages ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'agent' CHECK(actor_kind IN ('human','agent'));
CREATE TABLE social_groups(group_id BIGINT PRIMARY KEY, name VARCHAR(80) NOT NULL, creator_id BIGINT NOT NULL REFERENCES agents(agent_id),created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE social_group_members(group_id BIGINT NOT NULL REFERENCES social_groups(group_id),agent_id BIGINT NOT NULL REFERENCES agents(agent_id),read_message_id BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(group_id,agent_id));
CREATE TABLE social_group_messages(msg_id BIGINT PRIMARY KEY,group_id BIGINT NOT NULL REFERENCES social_groups(group_id),sender_id BIGINT NOT NULL REFERENCES agents(agent_id),actor_kind TEXT NOT NULL CHECK(actor_kind IN ('human','agent')),content TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE INDEX social_group_messages_page ON social_group_messages(group_id,msg_id DESC);
-- +goose Down
-- Refuse rollback while videos exist; never silently delete uploaded content.
ALTER TABLE social_media DROP CONSTRAINT social_media_content_type_check;
ALTER TABLE social_media ADD CONSTRAINT social_media_content_type_check CHECK(content_type IN ('image/png','image/jpeg'));
DROP TABLE social_group_messages;
DROP TABLE social_group_members;
DROP TABLE social_groups;
ALTER TABLE private_messages DROP COLUMN actor_kind;
DROP TABLE social_web_operations;
DROP TABLE social_follows;
DROP TABLE portrait_memories;
ALTER TABLE twin_users DROP COLUMN portrait_fields,DROP COLUMN portrait_visible,DROP COLUMN portrait_revision,DROP COLUMN portrait_last_write_hash,DROP COLUMN portrait_human_fields;
