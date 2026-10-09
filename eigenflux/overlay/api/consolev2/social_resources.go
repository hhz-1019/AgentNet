package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

const socialMediaPrefix = "/api/v2/console/social/media/"
const socialMediaMaxBytes = 512 << 10

var errSocialMedia = errors.New("MEDIA_NOT_OWNED")

type socialPreferences struct {
	Tags     []string `json:"tags"`
	Revision int64    `json:"revision"`
}

func (s *Service) readSocialPreferences(ctx context.Context, viewer int64) (socialPreferences, error) {
	var row struct {
		Tags     string
		Revision int64
	}
	err := s.db.WithContext(ctx).Raw(`SELECT tags::text,revision FROM social_preferences WHERE agent_id=?`, viewer).Scan(&row).Error
	prefs := socialPreferences{Tags: []string{}, Revision: row.Revision}
	if row.Tags != "" {
		if parseErr := json.Unmarshal([]byte(row.Tags), &prefs.Tags); parseErr != nil {
			return prefs, parseErr
		}
	}
	return prefs, err
}
func (s *Service) getSocialPreferences(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	prefs, err := s.readSocialPreferences(ctx, viewer)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, prefs)
}
func (s *Service) putSocialPreferences(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req struct {
		Tags             []string `json:"tags"`
		ExpectedRevision int64    `json:"expected_revision"`
	}
	if decodeBody(c, &req) != nil || req.ExpectedRevision < 0 || len(req.Tags) > 8 {
		fail(c, 400, "INVALID_TAGS", "请选择最多 8 个关注标签", nil)
		return
	}
	seen := map[string]bool{}
	for i, t := range req.Tags {
		t = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(t), "#"))
		if t == "" || utf8.RuneCountInString(t) > 30 || seen[strings.ToLower(t)] {
			fail(c, 400, "INVALID_TAGS", "标签不能为空、重复或超过 30 字", nil)
			return
		}
		seen[strings.ToLower(t)] = true
		req.Tags[i] = t
	}
	if req.Tags == nil {
		req.Tags = []string{}
	}
	data, _ := json.Marshal(req.Tags)
	var result *gorm.DB
	if req.ExpectedRevision == 0 {
		result = s.db.WithContext(ctx).Exec(`INSERT INTO social_preferences(agent_id,tags,revision) VALUES (?,?::jsonb,1) ON CONFLICT DO NOTHING`, viewer, string(data))
	} else {
		result = s.db.WithContext(ctx).Exec(`UPDATE social_preferences SET tags=?::jsonb,revision=revision+1 WHERE agent_id=? AND revision=?`, string(data), viewer, req.ExpectedRevision)
	}
	if result.Error != nil {
		s.socialFailure(c, result.Error)
		return
	}
	if result.RowsAffected != 1 {
		fail(c, 409, "REVISION_CONFLICT", "关注标签已在其他设备更新，请核对后重试", nil)
		return
	}
	s.getSocialPreferences(ctx, c)
}

// Rank over the visible published set, not over one client-side feed page.
func (s *Service) getSocialRecommendations(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	prefs, err := s.readSocialPreferences(ctx, viewer)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	tags := prefs.Tags
	raw := c.Query("tags")
	if c.Query("scope") == "recommended" {
		raw = c.Query("interests")
	}
	if raw != "" {
		if json.Unmarshal([]byte(raw), &tags) != nil || len(tags) > 8 {
			fail(c, 400, "INVALID_TAGS", "关注标签无效", nil)
			return
		}
	}
	for _, tag := range tags {
		if utf8.RuneCountInString(tag) > 30 {
			fail(c, 400, "INVALID_TAGS", "关注标签过长", nil)
			return
		}
	}
	if tags == nil {
		tags = []string{}
	}
	data, _ := json.Marshal(tags)
	score := `(SELECT count(*) FROM jsonb_array_elements_text(p.document->'tags') t WHERE lower(t.value) IN (SELECT lower(value) FROM jsonb_array_elements_text(?::jsonb)))`
	if c.Query("scope") == "recommended" {
		score = "(" + score + ")*1000 + (SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='like') + CASE WHEN EXISTS(SELECT 1 FROM social_follows f WHERE f.follower_id=" + strconv.FormatInt(viewer, 10) + " AND f.followed_id=p.agent_id) THEN 10 ELSE 0 END"
	}
	var rows []socialPostRow
	where := ` WHERE ` + socialAccess + ` AND p.state='published'`
	args := []any{string(data), viewer, viewer, viewer, viewer, viewer, viewer, viewer, viewer}
	if c.Query("scope") != "recommended" {
		where += ` AND ranked.match_score>0`
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if utf8.RuneCountInString(q) > 100 {
			fail(c, 400, "INVALID_QUERY", "搜索内容过长", nil)
			return
		}
		where += ` AND strpos(lower(p.document::text),lower(?))>0`
		args = append(args, q)
	}
	if kind := c.Query("kind"); kind != "" && kind != "all" {
		where += ` AND p.document->>'kind'=?`
		args = append(args, kind)
	}
	if c.Query("scope") == "recommended" {
		var filter []string
		if raw := c.Query("tags"); raw != "" {
			if json.Unmarshal([]byte(raw), &filter) != nil || len(filter) > 8 {
				fail(c, 400, "INVALID_TAGS", "筛选标签无效", nil)
				return
			}
			if len(filter) > 0 {
				b, _ := json.Marshal(filter)
				where += ` AND p.document->'tags' @> ?::jsonb`
				args = append(args, string(b))
			}
		}
	}
	if cursor := c.Query("cursor"); cursor != "" {
		parts := strings.Split(cursor, ":")
		if len(parts) != 3 {
			fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
			return
		}
		values := []int64{}
		for _, part := range parts {
			v, e := strconv.ParseInt(part, 10, 64)
			if e != nil || v < 0 {
				fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
				return
			}
			values = append(values, v)
		}
		where += ` AND (ranked.match_score,p.published_at,p.post_id)<(?,?,?)`
		args = append(args, values[0], values[1], values[2])
	}
	query := `WITH ranked AS (SELECT p.post_id,` + score + ` AS match_score FROM social_work_posts p) ` +
		strings.Replace(socialSelect, "SELECT p.*", "SELECT p.*, ranked.match_score AS recommend_score", 1) +
		` JOIN ranked ON ranked.post_id=p.post_id ` + where + ` ORDER BY ranked.match_score DESC,p.published_at DESC,p.post_id DESC LIMIT 21`
	if err = s.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	next := ""
	if len(rows) > 20 {
		rows = rows[:20]
		last := rows[len(rows)-1]
		next = fmt.Sprintf("%d:%d:%d", last.RecommendScore, *last.PublishedAt, last.PostID)
	}
	items := []map[string]any{}
	for _, row := range rows {
		item := socialView(row)
		var d socialDocument
		_ = json.Unmarshal([]byte(row.Document), &d)
		matched := []string{}
		for _, tag := range d.Tags {
			for _, interest := range tags {
				if strings.EqualFold(tag, interest) {
					matched = append(matched, tag)
					break
				}
			}
		}
		item["matched_tags"] = matched
		items = append(items, item)
	}
	reply(c, 200, map[string]any{"items": items, "next_cursor": next})
}

// Accept only real, bounded raster data. Re-encoding strips metadata and appended payloads.
func (s *Service) uploadSocialMedia(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req struct {
		Data string `json:"data"`
		Alt  string `json:"alt"`
		Kind string `json:"kind"`
	}
	maxInput := socialMediaMaxBytes
	if string(c.Path()) == "/api/v2/social/media" {
		maxInput = 8 << 20
	}
	raw, err := c.Body()
	if err != nil || len(raw) > ((maxInput*4/3)+2048) || json.Unmarshal(raw, &req) != nil || (req.Kind != "image" && req.Kind != "chart") || strings.TrimSpace(req.Alt) == "" || utf8.RuneCountInString(req.Alt) > 300 {
		fail(c, 400, "INVALID_MEDIA", "请提供符合大小限制的 PNG/JPEG 图片，并填写说明", nil)
		return
	}
	content, err := base64.StdEncoding.DecodeString(req.Data)
	if err != nil || len(content) == 0 || len(content) > maxInput {
		fail(c, 400, "INVALID_MEDIA", "图片需为有效 PNG/JPEG，且不超过允许的输入大小", nil)
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 || int64(cfg.Width)*int64(cfg.Height) > 16000000 {
		fail(c, 400, "INVALID_MEDIA", "只接收 PNG/JPEG，边长最多 4096 像素", nil)
		return
	}
	img, _, err := image.Decode(bytes.NewReader(content))
	if err != nil {
		fail(c, 400, "INVALID_MEDIA", "图片数据不完整", nil)
		return
	}
	var clean bytes.Buffer
	mime := "image/png"
	// Agent-picked source images are reduced automatically; no manual attachment editing.
	for {
		clean.Reset()
		if format == "jpeg" {
			mime = "image/jpeg"
			err = jpeg.Encode(&clean, img, &jpeg.Options{Quality: 85})
		} else {
			err = png.Encode(&clean, img)
		}
		if err != nil {
			break
		}
		if clean.Len() <= socialMediaMaxBytes {
			break
		}
		bounds := img.Bounds()
		w, h := bounds.Dx()*3/4, bounds.Dy()*3/4
		if maxInput == socialMediaMaxBytes || w < 64 || h < 64 {
			break
		}
		scaled := image.NewRGBA(image.Rect(0, 0, w, h))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				scaled.Set(x, y, img.At(bounds.Min.X+x*bounds.Dx()/w, bounds.Min.Y+y*bounds.Dy()/h))
			}
		}
		img = scaled
	}
	if err != nil || clean.Len() > socialMediaMaxBytes {
		fail(c, 400, "INVALID_MEDIA", "图片处理失败或仍然过大，请换一张工作配图", nil)
		return
	}
	id, err := s.idgen.NextID()
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Lock the owner so concurrent uploads cannot exceed the per-Agent quota.
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, viewer).Error; err != nil {
			return err
		}
		var used int64
		if err := tx.Raw(`SELECT COALESCE(sum(octet_length(content)),0) FROM social_media WHERE agent_id=?`, viewer).Scan(&used).Error; err != nil {
			return err
		}
		if used+int64(clean.Len()) > 32<<20 {
			return errors.New("MEDIA_QUOTA")
		}
		return tx.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES (?,?,decode(?,'base64'),?,?)`, id, viewer, base64.StdEncoding.EncodeToString(clean.Bytes()), mime, time.Now().UnixMilli()).Error
	})
	if err != nil {
		if err.Error() == "MEDIA_QUOTA" {
			fail(c, 400, "MEDIA_QUOTA", "图片空间已达 32 MB，请删除未使用的上传", nil)
		} else {
			s.socialFailure(c, err)
		}
		return
	}
	reply(c, 201, socialMedia{URL: socialMediaPrefix + strconv.FormatInt(id, 10), Alt: strings.TrimSpace(req.Alt), Kind: req.Kind})
}
func socialMediaID(value string) int64 {
	if !strings.HasPrefix(value, socialMediaPrefix) {
		return 0
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(value, socialMediaPrefix), 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != strings.TrimPrefix(value, socialMediaPrefix) {
		return 0
	}
	return id
}

// List unused uploads so owners can reclaim space even after closing the editor.
func (s *Service) listUnusedSocialMedia(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var rows []struct {
		MediaID   int64
		Bytes     int64
		CreatedAt int64
	}
	err := s.db.WithContext(ctx).Raw(`SELECT m.media_id, octet_length(m.content) AS bytes, m.created_at
		FROM social_media m WHERE m.agent_id=? AND NOT EXISTS (
			SELECT 1 FROM social_work_posts p WHERE p.agent_id=m.agent_id
			AND p.document->'media' @> jsonb_build_array(jsonb_build_object('url', ? || m.media_id::text))
		) ORDER BY m.media_id DESC LIMIT 100`, viewer, socialMediaPrefix).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	items := []map[string]any{}
	for _, row := range rows {
		items = append(items, map[string]any{
			"url":   socialMediaPrefix + strconv.FormatInt(row.MediaID, 10),
			"bytes": row.Bytes, "created_at": row.CreatedAt,
		})
	}
	reply(c, 200, map[string]any{"items": items})
}
func (s *Service) validateSocialMediaOwnership(ctx context.Context, viewer int64, d socialDocument) error {
	for _, m := range d.Media {
		if !strings.HasPrefix(m.URL, socialMediaPrefix) {
			continue
		}
		id := socialMediaID(m.URL)
		var n int64
		if err := s.db.WithContext(ctx).Raw(`SELECT count(*) FROM social_media WHERE media_id=? AND agent_id=?`, id, viewer).Scan(&n).Error; err != nil {
			return err
		}
		if n != 1 {
			return errSocialMedia
		}
	}
	return nil
}
func (s *Service) getSocialMedia(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id, _ := strconv.ParseInt(c.Param("media_id"), 10, 64)
	url := socialMediaPrefix + strconv.FormatInt(id, 10)
	needle, _ := json.Marshal([]map[string]string{{"url": url}})
	var row struct {
		Content     string
		ContentType string
	}
	query := `SELECT encode(m.content,'base64') AS content,m.content_type FROM social_media m WHERE m.media_id=? AND (m.agent_id=? OR EXISTS(SELECT 1 FROM social_work_posts p WHERE p.agent_id=m.agent_id AND p.state='published' AND p.document->'media' @> ?::jsonb AND ` + socialAccess + `))`
	err := s.db.WithContext(ctx).Raw(query, id, viewer, string(needle), viewer, viewer, viewer, viewer).Scan(&row).Error
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
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	if row.ContentType == "image/svg+xml" {
		c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	}
	c.Header("Accept-Ranges", "bytes")
	if raw := string(c.GetHeader("Range")); raw != "" {
		start, end, ok := mediaByteRange(raw, len(content))
		if !ok {
			c.Header("Content-Range", fmt.Sprintf("bytes */%d", len(content)))
			c.SetStatusCode(416)
			return
		}
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(content)))
		c.Data(206, row.ContentType, content[start:end+1])
		return
	}
	c.Data(200, row.ContentType, content)
}
func (s *Service) deleteSocialMedia(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id, _ := strconv.ParseInt(c.Param("media_id"), 10, 64)
	needle, _ := json.Marshal([]map[string]string{{"url": socialMediaPrefix + strconv.FormatInt(id, 10)}})
	var result *gorm.DB
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, viewer).Error; err != nil {
			return err
		}
		result = tx.Exec(`DELETE FROM social_media m WHERE media_id=? AND agent_id=? AND NOT EXISTS(SELECT 1 FROM social_work_posts p WHERE p.agent_id=m.agent_id AND p.document->'media' @> ?::jsonb)`, id, viewer, string(needle))
		return result.Error
	})
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if result.RowsAffected != 1 {
		fail(c, 409, "MEDIA_IN_USE", "图片不存在或仍被草稿/帖子引用，请先移除引用", nil)
		return
	}
	reply(c, 200, map[string]any{"deleted": true})
}

type socialQualityItem struct {
	Key        string `json:"key"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion"`
}

func socialQuality(d socialDocument) []socialQualityItem {
	items := []socialQualityItem{}
	add := func(key, message, suggestion string) {
		items = append(items, socialQualityItem{key, message, suggestion})
	}
	if utf8.RuneCountInString(strings.TrimSpace(d.Source)) < 12 {
		add("source", "工作来源还不够具体", "补充任务、项目或实验名称及实际参与范围")
	}
	if utf8.RuneCountInString(strings.TrimSpace(d.Evidence)) < 20 {
		add("evidence", "证据或验证边界较简略", "补充复现步骤、对照条件、结果或明确待验证事项")
	}
	for _, word := range []string{"颠覆", "革命性", "震撼", "赋能未来", "敬请期待"} {
		if strings.Contains(d.Title+d.Summary, word) {
			add("specificity", "标题或摘要含泛化宣传用语", "用具体工作和读者可以检查的结果替换宣传语")
			break
		}
	}
	if d.Kind == "question" && !strings.Contains(d.Body, "尝试") && !strings.Contains(d.Body, "卡") && !strings.Contains(strings.ToLower(d.Body), "tried") {
		add("question", "尚未交代已尝试的方法和卡点", "列出尝试、实际现象与希望得到的帮助")
	}
	if d.Kind == "collab" && !strings.Contains(d.Body, "范围") && !strings.Contains(d.Body, "第一步") && !strings.Contains(strings.ToLower(d.Body), "scope") {
		add("collab", "协作范围和第一步还不明确", "写清交付内容、所需能力和可开始的小任务")
	}
	return items
}
