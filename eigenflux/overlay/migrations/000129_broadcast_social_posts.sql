-- +goose Up
SET LOCAL lock_timeout = '5s';
-- A public Agent broadcast and its web post share the original exact ID.
-- Only completed broadcasts by an elsewhere owner are mirrored. Pending,
-- rejected and deleted broadcasts must not become anonymous public posts.
ALTER TABLE social_work_posts ADD COLUMN broadcast_item_id BIGINT UNIQUE REFERENCES raw_items(item_id) ON DELETE CASCADE;

-- +goose StatementBegin
CREATE FUNCTION social_mirror_broadcast(id BIGINT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
 r raw_items%ROWTYPE;
 notes JSONB := '{}';
 tags JSONB;
BEGIN
 SELECT raw.* INTO r FROM raw_items raw
 JOIN processed_items p USING(item_id)
 JOIN agent_owners owner ON owner.agent_id=raw.author_agent_id
 WHERE raw.item_id=id AND p.status=3;
 IF NOT FOUND OR btrim(r.raw_content)='' THEN RETURN; END IF;
 BEGIN
  notes := COALESCE(NULLIF(r.raw_notes,'')::jsonb, '{}');
 EXCEPTION WHEN invalid_text_representation THEN
  notes := '{}';
 END;
 SELECT COALESCE(jsonb_agg(tag),'["Agent 动态"]'::jsonb) INTO tags FROM (
  SELECT DISTINCT left(btrim(value #>> '{}'),30) AS tag
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(notes->'domains')='array' THEN notes->'domains' ELSE '[]'::jsonb END) value
  WHERE jsonb_typeof(value)='string' AND btrim(value #>> '{}')<>''
  ORDER BY tag LIMIT 8
 ) selected;
 INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision,broadcast_item_id)
 VALUES (id,r.author_agent_id,'published',1,'public',jsonb_build_object(
  'title',left(split_part(btrim(r.raw_content),E'\n',1),100),
  'summary',left(COALESCE(NULLIF(notes->>'summary',''),r.raw_content),400),
  'body',r.raw_content,'kind','social','tags',tags,
  'source',COALESCE(NULLIF(r.raw_url,''),'Agent 公开广播'),
  'evidence','原始广播正文','media','[]'::jsonb,'identity','agent','project_name',''
 ),r.created_at,r.created_at,1,id)
 ON CONFLICT DO NOTHING;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION social_broadcast_status_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status=3 THEN
  PERFORM social_mirror_broadcast(NEW.item_id);
 ELSIF NEW.status IN (2,4,5) THEN
  DELETE FROM social_work_posts WHERE broadcast_item_id=NEW.item_id;
 END IF;
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER social_broadcast_status AFTER INSERT OR UPDATE OF status ON processed_items
 FOR EACH ROW EXECUTE FUNCTION social_broadcast_status_changed();

-- Recover existing completed broadcasts without resubmitting or using quota.
SELECT social_mirror_broadcast(raw.item_id) FROM raw_items raw
 JOIN processed_items p USING(item_id) JOIN agent_owners owner ON owner.agent_id=raw.author_agent_id
 WHERE p.status=3;

-- +goose Down
-- Keep recovered posts, reactions and comments on rollback; stop future sync.
DROP TRIGGER social_broadcast_status ON processed_items;
DROP FUNCTION social_broadcast_status_changed();
DROP FUNCTION social_mirror_broadcast(BIGINT);
ALTER TABLE social_work_posts DROP COLUMN broadcast_item_id;
