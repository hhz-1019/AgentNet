package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Guest responses deliberately omit full documents, identities and interaction data.
// Every request rechecks publication scope; authenticated routes remain unchanged.
const guestPublished = `p.state='published' AND p.visibility='public' AND a.identity_state='active'`

type guestPost struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
	Kind    string `json:"kind"`
	Cover   string `json:"cover,omitempty"`
}

func guestText(value string, limit int) string {
	r := []rune(strings.TrimSpace(value))
	if len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return string(r)
}

func (s *Service) getGuestFeed(ctx context.Context, c *app.RequestContext) {
	var rows []struct {
		PostID   int64
		Document string
	}
	err := s.db.WithContext(ctx).Raw(`SELECT p.post_id,p.document::text AS document FROM social_work_posts p JOIN agents a USING(agent_id) WHERE ` + guestPublished + ` ORDER BY p.published_at DESC,p.post_id DESC LIMIT 24`).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	posts := []guestPost{}
	for _, row := range rows {
		var d socialDocument
		if json.Unmarshal([]byte(row.Document), &d) != nil {
			continue
		}
		excerpt := d.Summary
		if strings.TrimSpace(excerpt) == "" {
			excerpt = d.Body
		}
		p := guestPost{ID: strconv.FormatInt(row.PostID, 10), Title: guestText(d.Title, 100), Excerpt: guestText(excerpt, 90), Kind: d.Kind}
		if len(d.Media) > 0 && (d.Media[0].Kind == "image" || d.Media[0].Kind == "chart") {
			if socialMediaID(d.Media[0].URL) > 0 {
				p.Cover = "/api/v2/guest/posts/" + p.ID + "/cover"
			} else if validSocialURL(d.Media[0].URL, true) {
				p.Cover = d.Media[0].URL
			}
		}
		posts = append(posts, p)
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"items": posts})
}

func (s *Service) getGuestCover(ctx context.Context, c *app.RequestContext) {
	id := socialPathID(c)
	var row struct {
		Content     string
		ContentType string
	}
	// Only the first image of a currently public post can be served anonymously.
	err := s.db.WithContext(ctx).Raw(`SELECT encode(m.content,'base64') AS content,m.content_type FROM social_work_posts p JOIN agents a USING(agent_id) JOIN social_media m ON m.agent_id=p.agent_id AND p.document->'media'->0->>'url'=?||m.media_id::text WHERE p.post_id=? AND `+guestPublished+` AND p.document->'media'->0->>'kind' IN ('image','chart') AND m.content_type IN ('image/jpeg','image/png','image/webp','image/gif','image/svg+xml')`, socialMediaPrefix, id).Scan(&row).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if row.Content == "" {
		s.socialFailure(c, gorm.ErrRecordNotFound)
		return
	}
	content, err := base64.StdEncoding.DecodeString(row.Content)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Data(200, row.ContentType, content)
}
