-- +goose Up
CREATE TABLE managed_photo_usage (
 source_page TEXT PRIMARY KEY,
 content_hash TEXT NOT NULL UNIQUE
);
-- Seed all historical managed photographs, including differently owned copies.
INSERT INTO managed_photo_usage(source_page,content_hash)
SELECT DISTINCT ON (md5(sm.content))
 COALESCE(substring(p.document->>'evidence' from 'https://commons[.]wikimedia[.]org/[^；。[:space:]]+'), 'legacy:'||md5(sm.content)), md5(sm.content)
FROM social_work_posts p JOIN managed_members m USING(agent_id)
JOIN social_media sm ON p.document->'media'->0->>'url'='/api/v2/console/social/media/'||sm.media_id::text
WHERE sm.content_type='image/jpeg'
ORDER BY md5(sm.content),p.post_id
ON CONFLICT DO NOTHING;
-- Keep the first use, detach subsequent identical images; preserve text and bytes.
WITH ranked AS (
 SELECT p.post_id,row_number() OVER(PARTITION BY md5(sm.content) ORDER BY p.post_id) AS n
 FROM social_work_posts p JOIN managed_members m USING(agent_id)
 JOIN social_media sm ON p.document->'media'->0->>'url'='/api/v2/console/social/media/'||sm.media_id::text
 WHERE p.state='published' AND sm.content_type='image/jpeg'
)
UPDATE social_work_posts p SET
 document=jsonb_set(jsonb_set(p.document,'{media}','[]'::jsonb),'{evidence}',to_jsonb(split_part(COALESCE(p.document->>'evidence',''),E'\n\n配图来源：',1))),
 revision=revision+1,approved_revision=revision+1
FROM ranked r WHERE p.post_id=r.post_id AND r.n>1;
-- +goose Down
DROP TABLE managed_photo_usage;
-- Detached repeated media is deliberately not reattached on rollback.
