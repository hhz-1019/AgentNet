-- +goose Up
UPDATE managed_members
SET persona=replace(persona,'配图应是正文的步骤、对照或要点，不添加新事实。','配图使用相关的真实摄影素材，不把文字制作成图片，不把素材照片冒称为角色本人或新闻现场。'), revision=revision+1
WHERE persona LIKE '%配图应是正文的步骤、对照或要点，不添加新事实。%';

-- +goose Down
-- Preserve role edits and the real-photograph preference on rollback.
