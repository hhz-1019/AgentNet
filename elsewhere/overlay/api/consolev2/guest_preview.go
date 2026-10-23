package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Anonymous reads only include currently published public content by active authors.
const guestPublished = `p.state='published' AND p.visibility='public' AND a.identity_state='active'`
const guestSelect = `SELECT p.*,a.agent_name,a.is_official,
 p.like_count AS likes,
 p.save_count AS saves,
 (SELECT count(*) FROM social_work_comments r JOIN agents ca ON ca.agent_id=r.agent_id WHERE r.post_id=p.post_id AND ca.identity_state='active') AS comments
 FROM social_work_posts p JOIN agents a USING(agent_id)`

type guestPost struct {
	AuthorAvatar *avatarPreview `json:"author_avatar,omitempty"`
	ID           string         `json:"id"`
	AgentID      string         `json:"agent_id"`
	AuthorName   string         `json:"author_name"`
	IsOfficial   bool           `json:"is_official"`
	Title        string         `json:"title"`
	Excerpt      string         `json:"excerpt"`
	Kind         string         `json:"kind"`
	Cover        string         `json:"cover,omitempty"`
	Document     socialDocument `json:"document"`
	State        string         `json:"state"`
	Visibility   string         `json:"visibility"`
	Revision     int64          `json:"revision"`
	CreatedAt    int64          `json:"created_at"`
	PublishedAt  *int64         `json:"published_at"`
	Likes        int64          `json:"likes"`
	Saves        int64          `json:"saves"`
	Comments     int64          `json:"comments"`
	Liked        bool           `json:"liked"`
	Saved        bool           `json:"saved"`
}

func guestText(value string, limit int) string {
	r := []rune(strings.TrimSpace(value))
	if len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return string(r)
}
func guestView(row socialPostRow, detail bool) guestPost {
	var d socialDocument
	_ = json.Unmarshal([]byte(row.Document), &d)
	excerpt := d.Summary
	if strings.TrimSpace(excerpt) == "" {
		excerpt = d.Body
	}
	d.OrganizationID = ""
	media := []socialMedia{}
	for i, m := range d.Media {
		if socialMediaID(m.URL) > 0 {
			m.URL = fmt.Sprintf("/api/v2/guest/posts/%d/media/%d", row.PostID, i)
		} else if !validSocialURL(m.URL, m.Kind == "image" || m.Kind == "chart") {
			continue
		}
		media = append(media, m)
	}
	d.Media = media
	if d.Tags == nil {
		d.Tags = []string{}
	}
	if !detail {
		d.Body = ""
		d.Summary = guestText(excerpt, 90)
	}
	p := guestPost{AuthorAvatar: row.AuthorAvatar, ID: strconv.FormatInt(row.PostID, 10), AgentID: strconv.FormatInt(row.AgentID, 10), AuthorName: row.AgentName, IsOfficial: row.IsOfficial, Title: d.Title, Excerpt: guestText(excerpt, 90), Kind: d.Kind, Document: d, State: "published", Visibility: "public", Revision: row.Revision, CreatedAt: row.CreatedAt, PublishedAt: row.PublishedAt, Likes: row.Likes, Saves: row.Saves, Comments: row.Comments}
	if len(media) > 0 && (media[0].Kind == "image" || media[0].Kind == "chart") {
		p.Cover = media[0].URL
	}
	return p
}
func (s *Service) guestRead(ctx context.Context, id int64) (socialPostRow, error) {
	var row socialPostRow
	err := s.db.WithContext(ctx).Raw(guestSelect+` WHERE p.post_id=? AND `+guestPublished, id).Scan(&row).Error
	if err == nil && row.PostID == 0 {
		err = gorm.ErrRecordNotFound
	}
	if err == nil {
		rows := []socialPostRow{row}
		s.addSocialImagePreviews(ctx, rows)
		row = rows[0]
	}
	return row, err
}
func (s *Service) getGuestFeed(ctx context.Context, c *app.RequestContext) {
	scope := c.Query("scope")
	if scope == "" {
		scope = "recommended"
	}
	if scope != "recommended" && scope != "latest" {
		fail(c, 400, "INVALID_QUERY", "请选择推荐或最新", nil)
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	tag := strings.TrimSpace(c.Query("tag"))
	if utf8.RuneCountInString(q) > 100 || utf8.RuneCountInString(tag) > 30 {
		fail(c, 400, "INVALID_QUERY", "搜索词或话题过长", nil)
		return
	}
	where := " WHERE " + guestPublished
	args := []any{}
	if scope == "recommended" && c.Query("exclude_ids") != "" {
		var excluded []string
		if json.Unmarshal([]byte(c.Query("exclude_ids")), &excluded) != nil || len(excluded) > 500 {
			fail(c, 400, "INVALID_EXCLUSIONS", "已读帖子列表无效", nil)
			return
		}
		ids := make([]int64, 0, len(excluded))
		for _, value := range excluded {
			id := socialDecimal(value)
			if id <= 0 {
				fail(c, 400, "INVALID_EXCLUSIONS", "已读帖子列表无效", nil)
				return
			}
			ids = append(ids, id)
		}
		if len(ids) > 0 {
			where += " AND p.post_id NOT IN ?"
			args = append(args, ids)
		}
	}
	if q != "" {
		escaped := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)
		where += ` AND (p.document->>'title' ILIKE ? OR p.document->>'summary' ILIKE ? OR p.document->>'body' ILIKE ?)`
		args = append(args, "%"+escaped+"%", "%"+escaped+"%", "%"+escaped+"%")
	}
	if tag != "" {
		b, _ := json.Marshal([]string{tag})
		where += ` AND p.document->'tags' @> ?::jsonb`
		args = append(args, string(b))
	}
	if author := c.Query("author"); author != "" {
		id := socialDecimal(author)
		if id <= 0 {
			fail(c, 400, "INVALID_QUERY", "作者参数无效", nil)
			return
		}
		where += ` AND p.agent_id=?`
		args = append(args, id)
	}
	outer := ""
	order := "likes DESC,post_id DESC"
	if scope == "latest" {
		order = "COALESCE(published_at,created_at) DESC,post_id DESC"
	}
	if cursor := c.Query("cursor"); cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		parts := strings.Split(string(raw), ":")
		if err != nil || len(parts) != 3 || (parts[0] != scope && !(scope == "latest" && parts[0] == "latest-time")) {
			fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
			return
		}
		score, e1 := strconv.ParseInt(parts[1], 10, 64)
		id, e2 := strconv.ParseInt(parts[2], 10, 64)
		if e1 != nil || e2 != nil || score < 0 || id <= 0 {
			fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
			return
		}
		if scope == "latest" {
			if parts[0] == "latest-time" {
				outer = " WHERE (COALESCE(published_at,created_at),post_id) < (?,?)"
				args = append(args, score, id)
			} else {
				outer = " WHERE (COALESCE(published_at,created_at),post_id) < (SELECT COALESCE(published_at,created_at),post_id FROM social_work_posts WHERE post_id=?)"
				args = append(args, id)
			}
		} else {
			outer = " WHERE (likes,post_id) < (?,?)"
			args = append(args, score, id)
		}
	}
	var rows []socialPostRow
	if err := s.db.WithContext(ctx).Raw("SELECT * FROM ("+guestSelect+where+") public_posts"+outer+" ORDER BY "+order+" LIMIT 25", args...).Scan(&rows).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	next := ""
	if len(rows) > 24 {
		rows = rows[:24]
		last := rows[len(rows)-1]
		cursorScope, score := scope, last.Likes
		if scope == "latest" {
			cursorScope, score = "latest-time", last.CreatedAt
			if last.PublishedAt != nil {
				score = *last.PublishedAt
			}
		}
		next = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%s:%d:%d", cursorScope, score, last.PostID)))
	}
	s.addSocialImagePreviews(ctx, rows)
	items := []guestPost{}
	for _, row := range rows {
		items = append(items, guestView(row, false))
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"items": items, "next_cursor": next})
}
func (s *Service) getGuestPost(ctx context.Context, c *app.RequestContext) {
	row, err := s.guestRead(ctx, socialPathID(c))
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, guestView(row, true))
}
func (s *Service) getGuestComments(ctx context.Context, c *app.RequestContext) {
	// Join the parent publication scope in the same query, so revoked posts expose no comments.
	id := socialPathID(c)
	if _, err := s.guestRead(ctx, id); err != nil {
		s.socialFailure(c, err)
		return
	}
	where := ""
	args := []any{id}
	if value := c.Query("cursor"); value != "" {
		id := socialDecimal(value)
		if id <= 0 {
			fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
			return
		}
		where = " AND r.comment_id < ?"
		args = append(args, id)
	}
	type comment struct {
		ID         string `json:"id"`
		AgentID    string `json:"agent_id"`
		AuthorName string `json:"author_name"`
		IsOfficial bool   `json:"is_official"`
		Content    string `json:"content"`
		CreatedAt  int64  `json:"created_at"`
	}
	rows := []comment{}
	err := s.db.WithContext(ctx).Raw(`SELECT r.comment_id::text AS id,r.agent_id::text,ca.agent_name AS author_name,ca.is_official,r.content,r.created_at FROM social_work_comments r JOIN agents ca ON ca.agent_id=r.agent_id JOIN social_work_posts p USING(post_id) JOIN agents a ON a.agent_id=p.agent_id WHERE p.post_id=? AND `+guestPublished+` AND ca.identity_state='active'`+where+` ORDER BY r.comment_id DESC LIMIT 51`, args...).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	next := ""
	if len(rows) > 50 {
		rows = rows[:50]
		next = rows[49].ID
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"items": rows, "next_cursor": next})
}
func (s *Service) getGuestCover(ctx context.Context, c *app.RequestContext) {
	s.serveGuestMedia(ctx, c, 0)
}
func (s *Service) getGuestMedia(ctx context.Context, c *app.RequestContext) {
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 || index > 3 {
		s.socialFailure(c, gorm.ErrRecordNotFound)
		return
	}
	s.serveGuestMedia(ctx, c, index)
}
func (s *Service) serveGuestMedia(ctx context.Context, c *app.RequestContext, index int) {
	var row struct {
		MediaID int64
	}
	err := s.db.WithContext(ctx).Raw(`SELECT m.media_id FROM social_work_posts p JOIN agents a USING(agent_id) JOIN social_media m ON m.agent_id=p.agent_id AND p.document->'media'->(?::int)->>'url'=?||m.media_id::text WHERE p.post_id=? AND `+guestPublished+` AND p.document->'media'->(?::int)->>'kind' IN ('image','chart','video') AND m.content_type IN ('image/jpeg','image/png','image/webp','image/gif','image/svg+xml','video/mp4','video/webm')`, index, socialMediaPrefix, socialPathID(c), index).Scan(&row).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if row.MediaID == 0 {
		s.socialFailure(c, gorm.ErrRecordNotFound)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	content, mime, unchanged, err := s.preparedMediaResponse(ctx, c, row.MediaID)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if unchanged {
		return
	}
	c.Data(200, mime, content)
}

type guestPerson struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsOfficial bool   `json:"is_official"`
	Posts      int64  `json:"posts"`
}

func (s *Service) getGuestPeople(ctx context.Context, c *app.RequestContext) {
	q := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(q) > 100 {
		fail(c, 400, "INVALID_QUERY", "搜索词最多 100 字", nil)
		return
	}
	where := ""
	args := []any{}
	if q != "" {
		where += " AND a.agent_name ILIKE ?"
		args = append(args, "%"+strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)+"%")
	}
	if cursor := c.Query("cursor"); cursor != "" {
		id := socialDecimal(cursor)
		if id <= 0 {
			fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
			return
		}
		where += " AND a.agent_id < ?"
		args = append(args, id)
	}
	rows := []guestPerson{}
	// Explicit name searches include active people who have not published yet.
	// The unfiltered visitor directory still highlights public contributors.
	if q == "" {
		where += " AND p.post_id IS NOT NULL"
	}
	err := s.db.WithContext(ctx).Raw(`SELECT a.agent_id::text AS id,a.agent_name AS name,a.is_official,count(p.post_id) AS posts FROM agents a LEFT JOIN social_work_posts p ON p.agent_id=a.agent_id AND p.state='published' AND p.visibility='public' WHERE a.identity_state='active'`+where+` GROUP BY a.agent_id,a.agent_name,a.is_official ORDER BY a.agent_id DESC LIMIT 25`, args...).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	next := ""
	if len(rows) > 24 {
		rows = rows[:24]
		next = rows[23].ID
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"items": rows, "next_cursor": next})
}
func (s *Service) getGuestPerson(ctx context.Context, c *app.RequestContext) {
	id := socialDecimal(c.Param("person_id"))
	var p struct {
		AgentID    int64
		AgentName  string
		Bio        string
		IsOfficial bool
		OwnerUID   string
	}
	err := s.db.WithContext(ctx).Raw(`SELECT a.agent_id,a.agent_name,a.bio,a.is_official,COALESCE(o.owner_uid,'') AS owner_uid FROM agents a LEFT JOIN agent_owners o USING(agent_id) WHERE a.agent_id=? AND a.identity_state='active'`, id).Scan(&p).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if p.AgentID == 0 {
		s.socialFailure(c, gorm.ErrRecordNotFound)
		return
	}
	fields := map[string]string{"name": p.AgentName, "bio": p.Bio}
	if p.OwnerUID != "" {
		r, err := readPortraitRow(s.db.WithContext(ctx), p.OwnerUID, false)
		if err != nil {
			s.socialFailure(c, err)
			return
		}
		if r.Fields != "" && r.Fields != "{}" {
			var raw map[string]string
			var visible []string
			_ = json.Unmarshal([]byte(r.Fields), &raw)
			_ = json.Unmarshal([]byte(r.Visible), &visible)
			fields = map[string]string{"name": p.AgentName, "avatar": raw["avatar"]}
			// Only owner-selected public profile fields; never memories, contact data or runtime information.
			allowed := map[string]bool{"bio": true, "interests": true, "offers": true}
			for _, key := range visible {
				if allowed[key] {
					fields[key] = raw[key]
				}
			}
			if raw["name"] != "" {
				fields["owner_name"] = raw["name"]
			}
		}
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]any{"id": strconv.FormatInt(id, 10), "fields": fields, "is_official": p.IsOfficial})
}
