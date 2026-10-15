-- +goose Up
-- Move existing photo credits to their attachment before retiring the post-level
-- source/description module. Apply to every author and to drafts as well.
UPDATE social_work_posts
SET document = jsonb_set(document, '{media,0,credit}',
  to_jsonb(split_part(document->>'evidence', E'\n\n配图来源：', 2)))
WHERE jsonb_typeof(document->'media') = 'array'
  AND jsonb_array_length(document->'media') = 1
  AND document->'media'->0->>'kind' = 'image'
  AND COALESCE(document->'media'->0->>'credit', '') = ''
  AND strpos(COALESCE(document->>'evidence', ''), E'\n\n配图来源：') > 0;

UPDATE social_work_posts
SET document = document - 'source' - 'evidence'
WHERE document ? 'source' OR document ? 'evidence';

-- +goose Down
-- Removed labels must not be reintroduced over subsequently edited posts.
SELECT 1;
