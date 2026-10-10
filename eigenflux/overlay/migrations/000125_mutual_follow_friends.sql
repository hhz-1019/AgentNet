-- +goose Up
-- Track only friendship rows created by mutual following; legacy friends survive unfollow.
CREATE TABLE social_follow_friendships (
 from_uid BIGINT NOT NULL REFERENCES agents(agent_id),
 to_uid BIGINT NOT NULL REFERENCES agents(agent_id),
 PRIMARY KEY(from_uid,to_uid)
);
WITH added AS (
 INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at)
 SELECT f.follower_id,f.followed_id,1,(extract(epoch FROM now())*1000)::bigint
 FROM social_follows f JOIN social_follows r ON r.follower_id=f.followed_id AND r.followed_id=f.follower_id
 JOIN agents a ON a.agent_id=f.follower_id AND a.identity_state='active'
 JOIN agents b ON b.agent_id=f.followed_id AND b.identity_state='active'
 WHERE NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=f.follower_id AND b.to_uid=f.followed_id) OR (b.to_uid=f.follower_id AND b.from_uid=f.followed_id)))
 ON CONFLICT DO NOTHING RETURNING from_uid,to_uid
) INSERT INTO social_follow_friendships SELECT * FROM added;
UPDATE friend_requests q SET status=1,updated_at=(extract(epoch FROM now())*1000)::bigint
WHERE q.status=0 AND EXISTS(SELECT 1 FROM social_follow_friendships f WHERE f.from_uid=q.from_uid AND f.to_uid=q.to_uid);
-- Removing friendship or blocking must not leave a mutual follow that silently recreates it.
-- +goose StatementBegin
CREATE FUNCTION social_clear_relationship_follows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a bigint; b bigint;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.rel_type<>1 THEN RETURN OLD; END IF;
  a:=OLD.from_uid; b:=OLD.to_uid;
 ELSE
  IF NEW.rel_type<>2 THEN RETURN NEW; END IF;
  a:=NEW.from_uid; b:=NEW.to_uid;
 END IF;
 IF TG_OP<>'DELETE' OR (EXISTS(SELECT 1 FROM social_follows WHERE follower_id=a AND followed_id=b) AND EXISTS(SELECT 1 FROM social_follows WHERE follower_id=b AND followed_id=a)) THEN
  DELETE FROM social_follows WHERE (follower_id=a AND followed_id=b) OR (follower_id=b AND followed_id=a);
 END IF;
 DELETE FROM social_follow_friendships WHERE (from_uid=a AND to_uid=b) OR (from_uid=b AND to_uid=a);
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER social_clear_relationship_follows AFTER INSERT OR DELETE ON user_relations FOR EACH ROW EXECUTE FUNCTION social_clear_relationship_follows();
-- +goose Down
DROP TRIGGER social_clear_relationship_follows ON user_relations;
DROP FUNCTION social_clear_relationship_follows();
DROP TABLE social_follow_friendships;
