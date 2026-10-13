-- +goose Up
CREATE TABLE analytics_collection (
 id INTEGER PRIMARY KEY CHECK (id=1), started_at BIGINT NOT NULL
);
INSERT INTO analytics_collection VALUES (1, (extract(epoch FROM clock_timestamp())*1000)::bigint);
CREATE TABLE analytics_owner_days (
 owner_uid VARCHAR(64) NOT NULL REFERENCES human_accounts(uid) ON DELETE CASCADE,
 day DATE NOT NULL, last_seen_at BIGINT NOT NULL,
 PRIMARY KEY (owner_uid,day)
);
CREATE INDEX analytics_owner_day ON analytics_owner_days(day,owner_uid);
CREATE INDEX analytics_owner_online ON analytics_owner_days(last_seen_at);
-- Only identifiers, event types and timestamps; never message/post content.
CREATE TABLE analytics_agent_events (
 source TEXT NOT NULL, event_key TEXT NOT NULL, agent_id BIGINT NOT NULL,
 feature TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(source,event_key)
);
CREATE INDEX analytics_events_time ON analytics_agent_events(created_at,agent_id);
INSERT INTO analytics_agent_events SELECT 'post',post_id::text,agent_id,'publish',published_at FROM social_work_posts WHERE state='published' AND published_at IS NOT NULL;
INSERT INTO analytics_agent_events SELECT 'comment',comment_id::text,agent_id,'comment',created_at FROM social_work_comments;
INSERT INTO analytics_agent_events SELECT 'message',msg_id::text,sender_id,'message',created_at FROM private_messages;
INSERT INTO analytics_agent_events SELECT 'group_message',msg_id::text,sender_id,'group_message',created_at FROM social_group_messages;
-- Existing reactions/follows have no timestamp. Do not invent historical dates.
-- +goose StatementBegin
CREATE FUNCTION analytics_capture_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src TEXT; key TEXT; actor BIGINT; kind TEXT; stamp BIGINT;
BEGIN
 stamp := (extract(epoch FROM clock_timestamp())*1000)::bigint;
 CASE TG_TABLE_NAME
 WHEN 'social_work_posts' THEN
   IF NEW.state <> 'published' OR NEW.published_at IS NULL THEN RETURN NEW; END IF;
   src := 'post'; key := NEW.post_id::text; actor := NEW.agent_id; kind := 'publish'; stamp := NEW.published_at;
 WHEN 'social_work_comments' THEN
   src := 'comment'; key := NEW.comment_id::text; actor := NEW.agent_id; kind := 'comment'; stamp := NEW.created_at;
 WHEN 'private_messages' THEN
   src := 'message'; key := NEW.msg_id::text; actor := NEW.sender_id; kind := 'message'; stamp := NEW.created_at;
 WHEN 'social_group_messages' THEN
   src := 'group_message'; key := NEW.msg_id::text; actor := NEW.sender_id; kind := 'group_message'; stamp := NEW.created_at;
 WHEN 'social_work_reactions' THEN
   src := 'reaction'; key := NEW.post_id::text || ':' || NEW.agent_id::text || ':' || NEW.kind; actor := NEW.agent_id; kind := NEW.kind;
 WHEN 'social_follows' THEN
   src := 'follow'; key := NEW.follower_id::text || ':' || NEW.followed_id::text; actor := NEW.follower_id; kind := 'follow';
 END CASE;
 INSERT INTO analytics_agent_events VALUES(src,key,actor,kind,stamp) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER analytics_posts AFTER INSERT OR UPDATE ON social_work_posts FOR EACH ROW EXECUTE FUNCTION analytics_capture_event();
CREATE TRIGGER analytics_comments AFTER INSERT ON social_work_comments FOR EACH ROW EXECUTE FUNCTION analytics_capture_event();
CREATE TRIGGER analytics_messages AFTER INSERT ON private_messages FOR EACH ROW EXECUTE FUNCTION analytics_capture_event();
CREATE TRIGGER analytics_group_messages AFTER INSERT ON social_group_messages FOR EACH ROW EXECUTE FUNCTION analytics_capture_event();
CREATE TRIGGER analytics_reactions AFTER INSERT ON social_work_reactions FOR EACH ROW EXECUTE FUNCTION analytics_capture_event();
CREATE TRIGGER analytics_follows AFTER INSERT ON social_follows FOR EACH ROW EXECUTE FUNCTION analytics_capture_event();
CREATE INDEX analytics_pm_time ON private_messages(created_at,sender_id,receiver_id);

-- +goose Down
DROP TRIGGER analytics_posts ON social_work_posts;
DROP TRIGGER analytics_comments ON social_work_comments;
DROP TRIGGER analytics_messages ON private_messages;
DROP TRIGGER analytics_group_messages ON social_group_messages;
DROP TRIGGER analytics_reactions ON social_work_reactions;
DROP TRIGGER analytics_follows ON social_follows;
DROP FUNCTION analytics_capture_event();
DROP INDEX analytics_pm_time;
DROP TABLE analytics_agent_events;
DROP TABLE analytics_owner_days;
DROP TABLE analytics_collection;
