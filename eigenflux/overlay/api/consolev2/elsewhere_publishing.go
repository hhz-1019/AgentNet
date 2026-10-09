package consolev2

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// All webpage writes use sender-scoped keys and a payload digest. Retrying a
// timed-out request returns its committed resource; changing the payload does not.
func (s *Service) elsewhereOperation(ctx context.Context, agent int64, key string, payload any, write func(*gorm.DB, int64) error) (int64, error) {
	if len(key) < 8 || len(key) > 128 {
		return 0, errors.New("INVALID_KEY")
	}
	b, _ := json.Marshal(payload)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	var id int64
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, agent).Error; e != nil {
			return e
		}
		var prior struct {
			ResourceID  int64
			PayloadHash string
		}
		if e := tx.Raw(`SELECT resource_id,payload_hash FROM social_web_operations WHERE agent_id=? AND idempotency_key=?`, agent, key).Scan(&prior).Error; e != nil {
			return e
		}
		if prior.ResourceID != 0 {
			if prior.PayloadHash != hash {
				return errConflict
			}
			id = prior.ResourceID
			return nil
		}
		var count int64
		if e := tx.Raw(`SELECT count(*) FROM social_web_operations WHERE agent_id=? AND created_at>?`, agent, time.Now().Add(-24*time.Hour).UnixMilli()).Scan(&count).Error; e != nil {
			return e
		}
		if count >= 1000 {
			return errors.New("DAILY_LIMIT")
		}
		var e error
		id, e = s.idgen.NextID()
		if e != nil {
			return e
		}
		if e = write(tx, id); e != nil {
			return e
		}
		return tx.Exec(`INSERT INTO social_web_operations VALUES(?,?,?,?,?)`, agent, key, hash, id, time.Now().UnixMilli()).Error
	})
	return id, err
}
func (s *Service) elsewhereFailure(c *app.RequestContext, e error) {
	switch {
	case errors.Is(e, errSocialMedia):
		fail(c, 403, "MEDIA_FORBIDDEN", "附件不存在、类型不符或不属于当前账号", nil)
	case errors.Is(e, errConflict):
		fail(c, 409, "IDEMPOTENCY_CONFLICT", "本次操作内容已变化，请重新提交", nil)
	case errors.Is(e, gorm.ErrRecordNotFound):
		fail(c, 403, "COMMUNICATION_FORBIDDEN", "对象不存在、已被屏蔽或你没有此会话权限", nil)
	case e.Error() == "DAILY_LIMIT":
		fail(c, 429, "DAILY_LIMIT", "今日操作次数已达上限", nil)
	case e.Error() == "INVALID_KEY":
		fail(c, 400, "INVALID_KEY", "请提供有效操作编号", nil)
	default:
		s.socialFailure(c, e)
	}
}
func (s *Service) shareSocialPost(ctx context.Context, c *app.RequestContext) {
	_, viewer, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		Content    string        `json:"content"`
		Visibility string        `json:"visibility"`
		Media      []socialMedia `json:"media"`
		Key        string        `json:"idempotency_key"`
	}
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_SHARE", "动态格式无效", nil)
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if (req.Content == "" && len(req.Media) == 0) || utf8.RuneCountInString(req.Content) > 20000 || len(req.Media) > 4 || (req.Visibility != "public" && req.Visibility != "friends") {
		fail(c, 400, "INVALID_SHARE", "请填写正文或选择附件，最多 4 个附件", nil)
		return
	}
	if req.Media == nil {
		req.Media = []socialMedia{}
	}
	for _, m := range req.Media {
		if socialMediaID(m.URL) == 0 || (m.Kind != "image" && m.Kind != "video") || utf8.RuneCountInString(m.Alt) > 300 {
			fail(c, 400, "INVALID_MEDIA", "请先上传图片或视频", nil)
			return
		}
	}
	d := socialDocument{Body: req.Content, Kind: "social", Identity: "human", Tags: []string{}, Media: req.Media}
	blocked, _ := socialPreflight(d)
	if len(blocked) > 0 {
		fail(c, 400, "SOCIAL_PRIVACY_BLOCKED", blocked[0], nil)
		return
	}
	id, e := s.elsewhereOperation(ctx, viewer, "share:"+req.Key, req, func(tx *gorm.DB, id int64) error {
		scoped := *s
		scoped.db = tx
		if e := scoped.validateSocialMediaOwnership(ctx, viewer, d); e != nil {
			return e
		}
		for _, m := range d.Media {
			var mime string
			if e := tx.Raw(`SELECT content_type FROM social_media WHERE media_id=?`, socialMediaID(m.URL)).Scan(&mime).Error; e != nil {
				return e
			}
			if !strings.HasPrefix(mime, m.Kind+"/") {
				return errSocialMedia
			}
		}
		b, _ := json.Marshal(d)
		now := time.Now().UnixMilli()
		return tx.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,'published',1,?,?::jsonb,?,?,1)`, id, viewer, req.Visibility, string(b), now, now).Error
	})
	if e != nil {
		s.elsewhereFailure(c, e)
		return
	}
	p, e := s.socialRead(ctx, viewer, id)
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	reply(c, 201, socialView(p))
}

// Bounded binary storage uses the existing authenticated media access check.
// Raster data is decoded and re-encoded; video is restricted to MP4/WebM.
func (s *Service) uploadSocialAttachment(ctx context.Context, c *app.RequestContext) {
	_, viewer, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		Data string `json:"data"`
		Alt  string `json:"alt"`
		Kind string `json:"kind"`
		Key  string `json:"idempotency_key"`
	}
	raw, e := c.Body()
	if e != nil || len(raw) > 12<<20 || json.Unmarshal(raw, &req) != nil {
		fail(c, 400, "INVALID_MEDIA", "附件格式无效", nil)
		return
	}
	b, e := base64.StdEncoding.DecodeString(req.Data)
	if e != nil || len(b) == 0 || len(b) > 8<<20 || utf8.RuneCountInString(req.Alt) > 300 {
		fail(c, 400, "INVALID_MEDIA", "每个附件最多 8 MB", nil)
		return
	}
	mime := http.DetectContentType(b)
	if req.Kind == "image" {
		cfg, format, e := image.DecodeConfig(bytes.NewReader(b))
		if e != nil || (format != "png" && format != "jpeg") || cfg.Width > 4096 || cfg.Height > 4096 || cfg.Width*cfg.Height > 16000000 {
			fail(c, 400, "INVALID_MEDIA", "图片需为 PNG/JPEG，边长最多 4096 像素", nil)
			return
		}
		img, _, e := image.Decode(bytes.NewReader(b))
		if e != nil {
			fail(c, 400, "INVALID_MEDIA", "图片损坏", nil)
			return
		}
		var clean bytes.Buffer
		if format == "png" {
			mime = "image/png"
			e = png.Encode(&clean, img)
		} else {
			mime = "image/jpeg"
			e = jpeg.Encode(&clean, img, &jpeg.Options{Quality: 90})
		}
		if e != nil || clean.Len() > 8<<20 {
			fail(c, 400, "INVALID_MEDIA", "图片处理后超过 8 MB", nil)
			return
		}
		b = clean.Bytes()
	} else if req.Kind != "video" || (mime != "video/mp4" && mime != "video/webm") {
		fail(c, 400, "INVALID_MEDIA", "视频需为 MP4 或 WebM", nil)
		return
	}
	// Hash the original upload, not the transformed bytes, so retries are stable.
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(req.Data)))
	id, e := s.elsewhereOperation(ctx, viewer, "media:"+req.Key, []string{hash, req.Kind, req.Alt}, func(tx *gorm.DB, id int64) error {
		var used int64
		if e := tx.Raw(`SELECT COALESCE(sum(octet_length(content)),0) FROM social_media WHERE agent_id=?`, viewer).Scan(&used).Error; e != nil {
			return e
		}
		if used+int64(len(b)) > 256<<20 {
			return errors.New("MEDIA_QUOTA")
		}
		return tx.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES(?,?,decode(?,'base64'),?,?)`, id, viewer, base64.StdEncoding.EncodeToString(b), mime, time.Now().UnixMilli()).Error
	})
	if e != nil {
		if e.Error() == "MEDIA_QUOTA" {
			fail(c, 400, "MEDIA_QUOTA", "媒体空间已达 256 MB，请清理未使用的附件", nil)
		} else {
			s.elsewhereFailure(c, e)
		}
		return
	}
	reply(c, 201, socialMedia{URL: socialMediaPrefix + strconv.FormatInt(id, 10), Alt: req.Alt, Kind: req.Kind})
}

func mediaByteRange(raw string, size int) (int, int, bool) {
	if !strings.HasPrefix(raw, "bytes=") || strings.Contains(raw, ",") || size < 1 {
		return 0, 0, false
	}
	parts := strings.Split(strings.TrimPrefix(raw, "bytes="), "-")
	if len(parts) != 2 {
		return 0, 0, false
	}
	start, end := 0, size-1
	if parts[0] == "" {
		n, e := strconv.Atoi(parts[1])
		if e != nil || n <= 0 {
			return 0, 0, false
		}
		if n < size {
			start = size - n
		}
	} else {
		n, e := strconv.Atoi(parts[0])
		if e != nil || n < 0 || n >= size {
			return 0, 0, false
		}
		start = n
		if parts[1] != "" {
			n, e = strconv.Atoi(parts[1])
			if e != nil || n < start {
				return 0, 0, false
			}
			if n < end {
				end = n
			}
		}
	}
	return start, end, true
}
