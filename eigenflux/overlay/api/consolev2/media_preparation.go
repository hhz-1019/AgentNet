package consolev2

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
	"log/slog"
	"os"
	"strconv"
	"time"
)

func mediaHash(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }
func insertPreparedMedia(tx *gorm.DB, id, agent int64, data []byte, mime string) error {
	preview, _ := json.Marshal(makeImagePreview(data))
	return tx.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at,preview,content_hash) VALUES(?,?,decode(?,'base64'),?,?,?::jsonb,?)`, id, agent, base64.StdEncoding.EncodeToString(data), mime, time.Now().UnixMilli(), string(preview), mediaHash(data)).Error
}

// One bounded asset per transaction, coordinated across replicas.
func (s *Service) prepareNextMedia(ctx context.Context) (bool, error) {
	worked := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row struct {
			MediaID     int64
			Content     []byte
			ContentType string
		}
		if err := tx.Raw(`SELECT media_id,content,content_type FROM social_media WHERE NOT variants_ready ORDER BY media_id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&row).Error; err != nil {
			return err
		}
		if row.MediaID != 0 {
			worked = true
			for _, width := range []int{320, 640, 960, 1440} {
				variant := resizedMedia(row.Content, row.ContentType, width)
				if len(variant.data) < len(row.Content) {
					if err := tx.Exec(`INSERT INTO social_media_variants(media_id,width,content,content_type,content_hash) VALUES(?,?,decode(?,'base64'),?,?) ON CONFLICT DO NOTHING`, row.MediaID, width, base64.StdEncoding.EncodeToString(variant.data), variant.mime, mediaHash(variant.data)).Error; err != nil {
						return err
					}
				}
			}
			p, _ := json.Marshal(makeImagePreview(row.Content))
			return tx.Exec(`UPDATE social_media SET preview=?::jsonb,content_hash=?,variants_ready=true WHERE media_id=?`, string(p), mediaHash(row.Content), row.MediaID).Error
		}
		var avatar struct {
			AvatarID string
			Content  []byte
		}
		if err := tx.Raw(`SELECT avatar_id,content FROM agent_avatars WHERE preview IS NULL ORDER BY avatar_id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&avatar).Error; err != nil {
			return err
		}
		if avatar.AvatarID != "" {
			worked = true
			p, _ := json.Marshal(makeImagePreview(avatar.Content))
			return tx.Exec(`UPDATE agent_avatars SET preview=?::jsonb WHERE avatar_id=?`, string(p), avatar.AvatarID).Error
		}
		return nil
	})
	return worked, err
}
func (s *Service) mediaPreparationLoop() {
	if os.Getenv("AGENTNET_MEDIA_PREPARATION") == "false" {
		return
	}
	delay := time.Second
	for {
		time.Sleep(delay)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		worked, err := s.prepareNextMedia(ctx)
		cancel()
		delay = 10 * time.Second
		if err != nil {
			slog.Warn("media preparation deferred")
			delay = time.Minute
		} else if worked {
			delay = 250 * time.Millisecond
		}
	}
}

// Authorization is required at the call site; cached bytes never cache permission.
func (s *Service) preparedMediaResponse(ctx context.Context, c *app.RequestContext, id int64) ([]byte, string, bool, error) {
	width, _ := strconv.Atoi(string(c.Query("w")))
	var meta struct {
		ContentHash, ContentType string
		Width                    int
	}
	err := s.db.WithContext(ctx).Raw(`SELECT COALESCE(v.content_hash,m.content_hash) AS content_hash,COALESCE(v.content_type,m.content_type) AS content_type,COALESCE(v.width,0) AS width FROM social_media m LEFT JOIN social_media_variants v ON v.media_id=m.media_id AND v.width=? WHERE m.media_id=?`, width, id).Scan(&meta).Error
	if err != nil {
		return nil, "", false, err
	}
	if meta.ContentType == "" {
		return nil, "", false, gorm.ErrRecordNotFound
	}
	if meta.ContentHash != "" && mediaUnchanged(c, meta.ContentHash) {
		return nil, meta.ContentType, true, nil
	}
	var data []byte
	if meta.Width > 0 {
		err = s.db.WithContext(ctx).Raw(`SELECT content FROM social_media_variants WHERE media_id=? AND width=?`, id, meta.Width).Row().Scan(&data)
	} else {
		err = s.db.WithContext(ctx).Raw(`SELECT content FROM social_media WHERE media_id=?`, id).Row().Scan(&data)
	}
	if err != nil {
		return nil, "", false, err
	}
	if meta.ContentHash == "" && mediaUnchanged(c, mediaHash(data)) {
		return nil, meta.ContentType, true, nil
	}
	return data, meta.ContentType, false, nil
}
