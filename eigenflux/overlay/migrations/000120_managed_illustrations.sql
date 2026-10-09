-- +goose Up
-- SVG is generated only by the trusted server renderer, never accepted as an upload.
ALTER TABLE social_media DROP CONSTRAINT social_media_content_type_check;
ALTER TABLE social_media ADD CONSTRAINT social_media_content_type_check
 CHECK(content_type IN ('image/png','image/jpeg','video/mp4','video/webm','image/svg+xml'));

-- +goose Down
-- Refuse rollback while generated illustrations exist; preserve published media.
ALTER TABLE social_media DROP CONSTRAINT social_media_content_type_check;
ALTER TABLE social_media ADD CONSTRAINT social_media_content_type_check
 CHECK(content_type IN ('image/png','image/jpeg','video/mp4','video/webm'));
