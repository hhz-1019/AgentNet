package consolev2

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	_ "image/jpeg"
	"image/png"
	"regexp"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

const avatarPrefix = "/api/v2/public/avatars/"

var customAvatarPattern = regexp.MustCompile(`^/api/v2/public/avatars/[a-f0-9]{32}$`)

func validPortraitAvatar(value string) bool {
	return validDefaultAvatar(value) || customAvatarPattern.MatchString(value)
}

func (s *Service) registerAvatarRoutes(h *server.Hertz) {
	go s.mediaPreparationLoop()
	h.POST("/api/v2/performance", s.performanceMetric)
	h.POST("/api/v2/console/portrait/avatar", s.consoleAuth(true), s.uploadAvatar)
	// A limited Agent may prepare a public avatar, but cannot publish posts.
	h.POST("/api/v2/agents/me/onboarding-avatar", s.agentAuth("onboarding:write"), s.uploadAvatar)
	h.GET(avatarPrefix+":id", s.getCustomAvatar)
}

func prepareAvatar(data string) ([]byte, error) {
	input, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(input) == 0 || len(input) > 8<<20 {
		return nil, errors.New("invalid avatar size")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(input))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 || int64(cfg.Width)*int64(cfg.Height) > 16000000 {
		return nil, errors.New("invalid avatar image")
	}
	src, _, err := image.Decode(bytes.NewReader(input))
	if err != nil {
		return nil, err
	}
	// Center crop to a fixed public thumbnail; strip EXIF and appended payloads.
	b := src.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	thumb := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			thumb.Set(x, y, src.At(x0+x*side/256, y0+y*side/256))
		}
	}
	var clean bytes.Buffer
	if err = png.Encode(&clean, thumb); err != nil {
		return nil, err
	}
	return clean.Bytes(), nil
}

func (s *Service) uploadAvatar(ctx context.Context, c *app.RequestContext) {
	id, ok := agentID(c)
	if !ok {
		fail(c, 401, "AGENT_REQUIRED", "请先接入 Agent", nil)
		return
	}
	var req struct {
		Data string `json:"data"`
	}
	body, err := c.Body()
	if err != nil || len(body) > (8<<20)*4/3+1024 || json.Unmarshal(body, &req) != nil {
		fail(c, 400, "INVALID_AVATAR", "请选择不超过 8 MB 的 PNG/JPEG 头像", nil)
		return
	}
	clean, err := prepareAvatar(req.Data)
	if err != nil {
		fail(c, 400, "INVALID_AVATAR", "请选择不超过 8 MB、边长不超过 4096 的 PNG/JPEG 头像", nil)
		return
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		s.socialFailure(c, err)
		return
	}
	key := hex.EncodeToString(nonce[:])
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE", id).Error; err != nil {
			return err
		}
		var used int64
		if err := tx.Raw("SELECT COALESCE(sum(octet_length(content)),0) FROM agent_avatars WHERE agent_id=?", id).Scan(&used).Error; err != nil {
			return err
		}
		if used+int64(len(clean)) > 8<<20 {
			return errors.New("AVATAR_QUOTA")
		}
		preview, _ := json.Marshal(makeImagePreview(clean))
		return tx.Exec("INSERT INTO agent_avatars(avatar_id,agent_id,content,created_at,preview) VALUES(?,?,decode(?,'base64'),?,?::jsonb)", key, id, base64.StdEncoding.EncodeToString(clean), time.Now().UnixMilli(), string(preview)).Error
	})
	if err != nil {
		if err.Error() == "AVATAR_QUOTA" {
			fail(c, 400, "AVATAR_QUOTA", "头像空间已满，请联系支持", nil)
		} else {
			s.socialFailure(c, err)
		}
		return
	}
	reply(c, 201, map[string]any{"avatar": avatarPrefix + key})
}

func (s *Service) getCustomAvatar(ctx context.Context, c *app.RequestContext) {
	key := c.Param("id")
	if !customAvatarPattern.MatchString(avatarPrefix + key) {
		c.Status(404)
		return
	}
	var row struct{ Content []byte }
	if err := s.db.WithContext(ctx).Raw("SELECT content FROM agent_avatars WHERE avatar_id=?", key).Scan(&row).Error; err != nil || len(row.Content) == 0 {
		c.Status(404)
		return
	}
	c.Response.Header.Set("Cache-Control", "public, max-age=31536000, immutable")
	c.Response.Header.Set("X-Content-Type-Options", "nosniff")
	c.Data(200, "image/png", row.Content)
}
