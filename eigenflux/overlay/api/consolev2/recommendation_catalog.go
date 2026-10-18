package consolev2

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
	"os"
	"strconv"
	"strings"
	"time"
)

// The bridge sends identifiers only. Materialize public metadata while holding
// source rows, so a stale bridge page cannot reinsert erased Gorse documents.
func (s *Service) syncRecommendationCatalog(ctx context.Context, c *app.RequestContext) {
	key := os.Getenv("AGENTNET_GORSE_API_KEY")
	if key == "" || !hmac.Equal([]byte(key), c.Request.Header.Peek("X-API-Key")) {
		fail(c, 403, "FORBIDDEN", "无权同步", nil)
		return
	}
	var req struct {
		PostIDs []string `json:"post_ids"`
	}
	if decodeBody(c, &req) != nil || len(req.PostIDs) > 100 {
		fail(c, 400, "INVALID_REQUEST", "同步参数无效", nil)
		return
	}
	ids := []int64{}
	for _, v := range req.PostIDs {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 {
			fail(c, 400, "INVALID_REQUEST", "同步参数无效", nil)
			return
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		reply(c, 200, map[string]any{"indexed": 0})
		return
	}
	endpoint := os.Getenv("AGENTNET_GORSE_URL")
	if endpoint == "" {
		fail(c, 503, "RECOMMENDATIONS_UNAVAILABLE", "推荐暂时不可用", nil)
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	count := 0
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []struct {
			PostID, PublishedAt, CreatedAt, Revision int64
			Document                                 []byte
		}
		if err := tx.Raw(`SELECT post_id,published_at,created_at,revision,document FROM social_work_posts WHERE post_id IN ? AND state='published' AND visibility='public' ORDER BY post_id FOR KEY SHARE`, ids).Scan(&rows).Error; err != nil {
			return err
		}
		items := []map[string]any{}
		for _, r := range rows {
			var d struct {
				Title, Summary, Body string
				Tags                 []string
			}
			if err := json.Unmarshal(r.Document, &d); err != nil {
				return err
			}
			stamp := r.PublishedAt
			if stamp == 0 {
				stamp = r.CreatedAt
			}
			items = append(items, map[string]any{"ItemId": "post:" + strconv.FormatInt(r.PostID, 10), "IsHidden": false, "Categories": []string{}, "Timestamp": time.UnixMilli(stamp).UTC().Format(time.RFC3339Nano), "Labels": map[string]any{"tags": d.Tags, "content_revision": r.Revision}, "Comment": strings.Trim(strings.Join([]string{d.Title, d.Summary, d.Body}, "\n"), "\n")})
		}
		count = len(items)
		if count == 0 {
			return nil
		}
		return (socialGorseClient{endpoint, key}).request(ctx, "POST", "/api/items", items, nil)
	})
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"indexed": count})
}
