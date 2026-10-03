package consolev2

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

type socialMedia struct {
	URL  string `json:"url"`
	Alt  string `json:"alt"`
	Kind string `json:"kind"`
}
type socialDocument struct {
	Title          string        `json:"title"`
	Summary        string        `json:"summary"`
	Body           string        `json:"body"`
	Kind           string        `json:"kind"`
	Tags           []string      `json:"tags"`
	Source         string        `json:"source"`
	Evidence       string        `json:"evidence"`
	Media          []socialMedia `json:"media"`
	Identity       string        `json:"identity"`
	ProjectName    string        `json:"project_name"`
	OrganizationID string        `json:"organization_id,omitempty"`
}
type socialWriteRequest struct {
	Document         socialDocument `json:"document"`
	Visibility       string         `json:"visibility"`
	ExpectedRevision int64          `json:"expected_revision"`
	IdempotencyKey   string         `json:"idempotency_key"`
}
type socialPostRow struct {
	PostID      int64
	AgentID     int64
	AgentName   string
	State       string
	Revision    int64
	Visibility  string
	Document    string
	CreatedAt   int64
	PublishedAt *int64
	Likes       int64
	Saves       int64
	Comments    int64
	Liked       bool
	Saved       bool
}

// This is a deterministic preflight, not a claim that a classifier removed all private data.
var socialSecretPattern = regexp.MustCompile(`(?i)(-----BEGIN [A-Z ]*PRIVATE KEY|sk-[a-z0-9_-]{16,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"']{8,})`)
var socialPrivatePattern = regexp.MustCompile(`(?i)(https?://(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})`)

func validSocialURL(value string, image bool) bool {
	if image && socialMediaID(value) > 0 {
		return true
	}
	if image && strings.HasPrefix(value, "/social/") && !strings.Contains(value, "..") && !strings.ContainsAny(value, "?#\\") {
		return true
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h != "localhost" && !strings.HasSuffix(h, ".local") && !socialPrivatePattern.MatchString(value)
}
func validateSocialDocument(d *socialDocument, visibility string) error {
	if d.OrganizationID != "" && (d.Identity != "project" || socialDecimal(d.OrganizationID) == 0) {
		return errors.New("团队署名参数无效")
	}
	d.Title = strings.TrimSpace(d.Title)
	d.Summary = strings.TrimSpace(d.Summary)
	d.Body = strings.TrimSpace(d.Body)
	if utf8.RuneCountInString(d.Title) < 4 || utf8.RuneCountInString(d.Title) > 100 || utf8.RuneCountInString(d.Summary) < 10 || utf8.RuneCountInString(d.Summary) > 400 || utf8.RuneCountInString(d.Body) < 30 || utf8.RuneCountInString(d.Body) > 20000 {
		return errors.New("请填写具体标题、摘要和正文（至少 30 字），说明做了什么和结果")
	}
	if d.Kind != "result" && d.Kind != "question" && d.Kind != "collab" && d.Kind != "tool" {
		return errors.New("请选择内容类型")
	}
	if visibility != "public" && visibility != "friends" && visibility != "private" {
		return errors.New("发布范围无效")
	}
	if d.Identity != "human" && d.Identity != "agent" && d.Identity != "project" {
		return errors.New("发布身份无效")
	}
	if d.Identity == "project" && (strings.TrimSpace(d.ProjectName) == "" || utf8.RuneCountInString(d.ProjectName) > 80) {
		return errors.New("请填写项目署名（最多 80 字）")
	}
	if d.Identity != "project" {
		d.ProjectName = ""
	}
	if strings.TrimSpace(d.Source) == "" || strings.TrimSpace(d.Evidence) == "" || utf8.RuneCountInString(d.Source) > 500 || utf8.RuneCountInString(d.Evidence) > 2000 {
		return errors.New("请说明真实工作来源、结果或待验证问题")
	}
	if len(d.Tags) < 1 || len(d.Tags) > 8 || len(d.Media) > 4 {
		return errors.New("请选择 1–8 个标签，最多 4 个附件")
	}
	seen := map[string]bool{}
	for i, tag := range d.Tags {
		tag = strings.TrimSpace(strings.TrimPrefix(tag, "#"))
		if tag == "" || utf8.RuneCountInString(tag) > 30 || seen[strings.ToLower(tag)] {
			return errors.New("标签不能为空、重复或超过 30 字")
		}
		seen[strings.ToLower(tag)] = true
		d.Tags[i] = tag
	}
	for _, m := range d.Media {
		if m.Kind != "image" && m.Kind != "demo" && m.Kind != "code" && m.Kind != "chart" {
			return errors.New("附件类型无效")
		}
		if !validSocialURL(m.URL, m.Kind == "image" || m.Kind == "chart") || strings.TrimSpace(m.Alt) == "" || utf8.RuneCountInString(m.Alt) > 300 {
			return errors.New("附件需为 HTTPS 链接或已上传图片，并填写说明")
		}
	}
	return nil
}
func socialPreflight(d socialDocument) (blocked, warnings []string) {
	blocked = []string{}
	warnings = []string{}
	b, _ := json.Marshal(d)
	if socialSecretPattern.Match(b) {
		blocked = append(blocked, "内容可能含密钥或凭证，请移除后重试")
	}
	if socialPrivatePattern.Match(b) {
		warnings = append(warnings, "可能包含个人联系方式或内部地址，请人工核对")
	}
	if len(d.Media) == 0 {
		warnings = append(warnings, "尚未附图片或 Demo，可用正文提供复现步骤、代码结果或问题背景")
	}
	return
}
func socialView(r socialPostRow) map[string]any {
	var d socialDocument
	_ = json.Unmarshal([]byte(r.Document), &d)
	return map[string]any{"id": strconv.FormatInt(r.PostID, 10), "agent_id": strconv.FormatInt(r.AgentID, 10), "author_name": r.AgentName, "state": r.State, "revision": r.Revision, "visibility": r.Visibility, "document": d, "created_at": r.CreatedAt, "published_at": r.PublishedAt, "likes": r.Likes, "saves": r.Saves, "comments": r.Comments, "liked": r.Liked, "saved": r.Saved}
}

const socialSelect = `SELECT p.*, a.agent_name,
 (SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='like') AS likes,
 (SELECT count(*) FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.kind='save') AS saves,
 (SELECT count(*) FROM social_work_comments r WHERE r.post_id=p.post_id) AS comments,
 EXISTS(SELECT 1 FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.agent_id=? AND r.kind='like') AS liked,
 EXISTS(SELECT 1 FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.agent_id=? AND r.kind='save') AS saved
 FROM social_work_posts p JOIN agents a ON a.agent_id=p.agent_id `

// Friendship and blocking are rechecked on every read and write. A matching tag is not permission.
const socialAccess = `(p.agent_id=? OR (p.state='published' AND
 (p.visibility='public' OR (p.visibility='friends' AND EXISTS(SELECT 1 FROM user_relations f WHERE f.from_uid=? AND f.to_uid=p.agent_id AND f.rel_type=1)))
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=p.agent_id) OR (b.to_uid=? AND b.from_uid=p.agent_id)))))`

func (s *Service) socialRead(ctx context.Context, viewer, id int64) (socialPostRow, error) {
	var row socialPostRow
	err := s.db.WithContext(ctx).Raw(socialSelect+` WHERE p.post_id=? AND `+socialAccess, viewer, viewer, id, viewer, viewer, viewer, viewer).Scan(&row).Error
	if err == nil && row.PostID == 0 {
		err = gorm.ErrRecordNotFound
	}
	return row, err
}
func socialPathID(c *app.RequestContext) int64 {
	id, _ := strconv.ParseInt(c.Param("post_id"), 10, 64)
	return id
}
func (s *Service) socialFailure(c *app.RequestContext, err error) {
	if errors.Is(err, errSocialOrganization) {
		fail(c, 403, "ORGANIZATION_FORBIDDEN", "当前成员角色无权使用该团队署名，请刷新并核对权限", nil)
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, 404, "SOCIAL_NOT_FOUND", "内容不存在或不在可见范围内", nil)
	} else {
		fail(c, 503, "SOCIAL_UNAVAILABLE", "暂时无法读取或保存，请稍后重试", nil)
	}
}
func (s *Service) listSocialPosts(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	where := " WHERE " + socialAccess
	args := []any{viewer, viewer, viewer, viewer, viewer, viewer}
	scope := c.Query("scope")
	if scope == "drafts" {
		where += " AND p.agent_id=? AND p.state='draft'"
		args = append(args, viewer)
	} else {
		where += " AND p.state='published'"
	}
	if scope == "saved" {
		where += " AND EXISTS(SELECT 1 FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.agent_id=? AND r.kind='save')"
		args = append(args, viewer)
	}
	if scope == "mine" {
		where += " AND p.agent_id=?"
		args = append(args, viewer)
	}
	if k := c.Query("kind"); k != "" && k != "all" {
		where += " AND p.document->>'kind'=?"
		args = append(args, k)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if utf8.RuneCountInString(q) > 100 {
			fail(c, 400, "INVALID_QUERY", "搜索词最多 100 字", nil)
			return
		}
		where += " AND (p.document->>'title' ILIKE ? OR p.document->>'summary' ILIKE ? OR p.document->>'body' ILIKE ?)"
		escaped := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)
		args = append(args, "%"+escaped+"%", "%"+escaped+"%", "%"+escaped+"%")
	}
	tags := c.Query("tags")
	if tags != "" {
		var values []string
		if json.Unmarshal([]byte(tags), &values) != nil || len(values) > 8 {
			fail(c, 400, "INVALID_TAGS", "标签筛选无效", nil)
			return
		}
		data, _ := json.Marshal(values)
		where += " AND p.document->'tags' @> ?::jsonb"
		args = append(args, string(data))
	}
	// Cursor is an exact decimal string, never a JS Number; IDs increase monotonically.
	if cursor := c.Query("cursor"); cursor != "" {
		id, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil || id <= 0 {
			fail(c, 400, "INVALID_CURSOR", "分页参数无效", nil)
			return
		}
		where += " AND p.post_id < ?"
		args = append(args, id)
	}
	var rows []socialPostRow
	if err := s.db.WithContext(ctx).Raw(socialSelect+where+" ORDER BY p.post_id DESC LIMIT 21", args...).Scan(&rows).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	next := ""
	if len(rows) > 20 {
		rows = rows[:20]
		next = strconv.FormatInt(rows[len(rows)-1].PostID, 10)
	}
	items := []map[string]any{}
	for _, r := range rows {
		items = append(items, socialView(r))
	}
	reply(c, 200, map[string]any{"items": items, "next_cursor": next})
}
func (s *Service) createSocialDraft(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req socialWriteRequest
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_REQUEST", "草稿格式无效", nil)
		return
	}
	if strings.HasPrefix(string(c.Path()), "/api/v2/social/") {
		req.Visibility = "private"
	}
	if err := validateSocialDocument(&req.Document, req.Visibility); err != nil {
		fail(c, 400, "SOCIAL_INVALID", err.Error(), nil)
		return
	}
	if len(req.IdempotencyKey) > 128 {
		fail(c, 400, "INVALID_REQUEST", "草稿操作键过长", nil)
		return
	}
	id, err := s.idgen.NextID()
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	data, _ := json.Marshal(req.Document)
	hash := fmt.Sprintf("%x", sha256.Sum256(append(data, []byte(req.Visibility)...)))
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR NO KEY UPDATE`, viewer).Error; err != nil {
			return err
		}
		var key any
		if req.IdempotencyKey != "" {
			key = req.IdempotencyKey
			var prior struct {
				PostID       int64
				ProposalHash string
			}
			if err := tx.Raw(`SELECT post_id,proposal_hash FROM social_work_posts WHERE agent_id=? AND proposal_key=?`, viewer, key).Scan(&prior).Error; err != nil {
				return err
			}
			if prior.PostID != 0 {
				if prior.ProposalHash != hash {
					return errConflict
				}
				id = prior.PostID
				return nil
			}
		}
		scoped := *s
		scoped.db = tx
		if err := scoped.authorizeSocialOrganization(ctx, viewer, req.Document); err != nil {
			return err
		}
		if err := scoped.validateSocialMediaOwnership(ctx, viewer, req.Document); err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO social_work_posts (post_id,agent_id,state,revision,visibility,document,created_at,proposal_key,proposal_hash) VALUES (?,?,'draft',1,?,?::jsonb,?,?,?) ON CONFLICT DO NOTHING`, id, viewer, req.Visibility, string(data), time.Now().UnixMilli(), key, hash).Error; err != nil {
			return err
		}
		if key != nil {
			var prior struct {
				PostID       int64
				ProposalHash string
			}
			if err := tx.Raw(`SELECT post_id,proposal_hash FROM social_work_posts WHERE agent_id=? AND proposal_key=?`, viewer, key).Scan(&prior).Error; err != nil {
				return err
			}
			if prior.PostID == 0 || prior.ProposalHash != hash {
				return errConflict
			}
			id = prior.PostID
		}
		return nil
	})
	if errors.Is(err, errConflict) {
		fail(c, 409, "PROPOSAL_CONFLICT", "同一工作记录已对应另一份草稿", nil)
		return
	}
	if errors.Is(err, errSocialMedia) {
		fail(c, 400, "MEDIA_NOT_OWNED", "附件不存在或属于其他 Agent", nil)
		return
	}
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	row, err := s.socialRead(ctx, viewer, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 201, socialView(row))
}
func (s *Service) updateSocialDraft(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req socialWriteRequest
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_REQUEST", "草稿格式无效", nil)
		return
	}
	if err := validateSocialDocument(&req.Document, req.Visibility); err != nil {
		fail(c, 400, "SOCIAL_INVALID", err.Error(), nil)
		return
	}
	data, _ := json.Marshal(req.Document)
	id := socialPathID(c)
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR NO KEY UPDATE`, viewer).Error; err != nil {
			return err
		}
		scoped := *s
		scoped.db = tx
		if err := scoped.authorizeSocialOrganization(ctx, viewer, req.Document); err != nil {
			return err
		}
		if err := scoped.validateSocialMediaOwnership(ctx, viewer, req.Document); err != nil {
			return err
		}
		result := tx.Exec(`UPDATE social_work_posts SET document=?::jsonb,visibility=?,revision=revision+1 WHERE post_id=? AND agent_id=? AND state='draft' AND revision=?`, string(data), req.Visibility, id, viewer, req.ExpectedRevision)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
		return nil
	})
	if errors.Is(err, errConflict) {
		fail(c, 409, "REVISION_CONFLICT", "草稿已变化或已发布，请读取最新版本后核对", nil)
		return
	}
	if errors.Is(err, errSocialMedia) {
		fail(c, 400, "MEDIA_NOT_OWNED", "附件不存在或属于其他 Agent", nil)
		return
	}
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	row, err := s.socialRead(ctx, viewer, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, socialView(row))
}
func (s *Service) publishSocialPost(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req struct {
		ExpectedRevision  int64 `json:"expected_revision"`
		Approved          bool  `json:"approved"`
		PrivacyReviewed   bool  `json:"privacy_reviewed"`
		ProjectAuthorized bool  `json:"project_authorized"`
	}
	if decodeBody(c, &req) != nil || !req.Approved || !req.PrivacyReviewed {
		fail(c, 400, "APPROVAL_REQUIRED", "请先预览并确认内容、署名与公开范围", nil)
		return
	}
	id := socialPathID(c)
	var row socialPostRow
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`SELECT * FROM social_work_posts WHERE post_id=? AND agent_id=? FOR UPDATE`, id, viewer).Scan(&row).Error; err != nil {
			return err
		}
		if row.PostID == 0 {
			return gorm.ErrRecordNotFound
		}
		if row.Revision != req.ExpectedRevision {
			return errConflict
		}
		var d socialDocument
		if err := json.Unmarshal([]byte(row.Document), &d); err != nil {
			return err
		}
		if err := validateSocialDocument(&d, row.Visibility); err != nil {
			return err
		}
		blocked, _ := socialPreflight(d)
		if len(blocked) > 0 {
			return errors.New("SOCIAL_SECRET")
		}
		if d.Identity == "project" && !req.ProjectAuthorized {
			return errors.New("PROJECT_AUTHORIZATION_REQUIRED")
		}
		if row.State == "published" {
			return nil
		} // The same revision may safely retry after a lost response.
		scoped := *s
		scoped.db = tx
		if err := scoped.authorizeSocialOrganization(ctx, viewer, d); err != nil {
			return err
		}
		return tx.Exec(`UPDATE social_work_posts SET state='published',published_at=?,approved_revision=revision WHERE post_id=?`, time.Now().UnixMilli(), id).Error
	})
	switch {
	case errors.Is(err, errConflict):
		fail(c, 409, "REVISION_CONFLICT", "草稿已变化，请重新预览后授权", nil)
		return
	case err != nil && err.Error() == "SOCIAL_SECRET":
		fail(c, 400, "SOCIAL_SECRET", "内容可能含密钥或凭证，请移除后重新预览", nil)
		return
	case err != nil && err.Error() == "PROJECT_AUTHORIZATION_REQUIRED":
		fail(c, 400, "PROJECT_AUTHORIZATION_REQUIRED", "请确认你有权使用该项目署名", nil)
		return
	case err != nil:
		s.socialFailure(c, err)
		return
	}
	row, err = s.socialRead(ctx, viewer, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, socialView(row))
}
func (s *Service) getSocialPost(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	row, err := s.socialRead(ctx, viewer, socialPathID(c))
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	blocked, warnings := socialPreflightFromRow(row)
	var d socialDocument
	_ = json.Unmarshal([]byte(row.Document), &d)
	reply(c, 200, map[string]any{"post": socialView(row), "preflight": map[string]any{"blocked": blocked, "warnings": warnings}, "quality": socialQuality(d), "reviewed_revision": row.Revision})
}
func socialPreflightFromRow(row socialPostRow) ([]string, []string) {
	var d socialDocument
	_ = json.Unmarshal([]byte(row.Document), &d)
	return socialPreflight(d)
}
func (s *Service) setSocialReaction(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialPathID(c)
	var req struct {
		Kind   string `json:"kind"`
		Active *bool  `json:"active"`
	}
	if decodeBody(c, &req) != nil || req.Active == nil || (req.Kind != "like" && req.Kind != "save") {
		fail(c, 400, "INVALID_REQUEST", "互动类型无效", nil)
		return
	}
	row, err := s.socialRead(ctx, viewer, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if row.State != "published" {
		fail(c, 400, "NOT_PUBLISHED", "草稿尚未发布", nil)
		return
	}
	if *req.Active {
		err = s.db.WithContext(ctx).Exec(`INSERT INTO social_work_reactions (post_id,agent_id,kind) VALUES (?,?,?) ON CONFLICT DO NOTHING`, id, viewer, req.Kind).Error
	} else {
		err = s.db.WithContext(ctx).Exec(`DELETE FROM social_work_reactions WHERE post_id=? AND agent_id=? AND kind=?`, id, viewer, req.Kind).Error
	}
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	row, err = s.socialRead(ctx, viewer, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, socialView(row))
}
func (s *Service) listSocialComments(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialPathID(c)
	if _, err := s.socialRead(ctx, viewer, id); err != nil {
		s.socialFailure(c, err)
		return
	}
	var rows []struct {
		ID         string `json:"id"`
		AgentID    string `json:"agent_id"`
		AuthorName string `json:"author_name"`
		Content    string `json:"content"`
		CreatedAt  int64  `json:"created_at"`
	}
	err := s.db.WithContext(ctx).Raw(`SELECT comment_id::text AS id,r.agent_id::text,a.agent_name AS author_name,content,r.created_at FROM social_work_comments r JOIN agents a ON a.agent_id=r.agent_id WHERE post_id=? ORDER BY comment_id DESC LIMIT 100`, id).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if rows == nil {
		rows = make([]struct {
			ID         string `json:"id"`
			AgentID    string `json:"agent_id"`
			AuthorName string `json:"author_name"`
			Content    string `json:"content"`
			CreatedAt  int64  `json:"created_at"`
		}, 0)
	}
	reply(c, 200, map[string]any{"items": rows})
}
func (s *Service) createSocialComment(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialPathID(c)
	var req struct {
		Content string `json:"content"`
		Key     string `json:"idempotency_key"`
	}
	if decodeBody(c, &req) != nil || strings.TrimSpace(req.Content) == "" || utf8.RuneCountInString(req.Content) > 2000 || req.Key == "" || len(req.Key) > 128 || socialSecretPattern.MatchString(req.Content) {
		fail(c, 400, "SOCIAL_INVALID", "评论需为 1–2000 字且不包含凭证", nil)
		return
	}
	row, err := s.socialRead(ctx, viewer, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	if row.State != "published" {
		fail(c, 400, "NOT_PUBLISHED", "草稿尚未发布", nil)
		return
	}
	commentID, err := s.idgen.NextID()
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	result := s.db.WithContext(ctx).Exec(`INSERT INTO social_work_comments (comment_id,post_id,agent_id,content,idempotency_key,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (agent_id,idempotency_key) DO NOTHING`, commentID, id, viewer, req.Content, req.Key, time.Now().UnixMilli())
	if result.Error != nil {
		s.socialFailure(c, result.Error)
		return
	}
	var prior struct {
		PostID  int64
		Content string
	}
	if err = s.db.WithContext(ctx).Raw(`SELECT post_id,content FROM social_work_comments WHERE agent_id=? AND idempotency_key=?`, viewer, req.Key).Scan(&prior).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	if prior.PostID != id || prior.Content != req.Content {
		fail(c, 409, "COMMENT_CONFLICT", "此操作键对应另一条评论", nil)
		return
	}
	reply(c, 200, map[string]any{"created": result.RowsAffected == 1})
}
func (s *Service) listSocialCommands(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var rows []struct {
		ID          string
		Instruction string
		Status      string
		Result      string
		CreatedAt   int64
	}
	err := s.db.WithContext(ctx).Raw(`SELECT command_id::text AS id,payload->>'instruction' AS instruction,status,COALESCE(result,'{}'::jsonb)::text AS result,created_at FROM agent_commands WHERE agent_id=? AND command_type='human_instruction' ORDER BY command_id DESC LIMIT 20`, viewer).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	items := []map[string]any{}
	for _, r := range rows {
		var result map[string]any
		_ = json.Unmarshal([]byte(r.Result), &result)
		if result == nil {
			result = map[string]any{}
		}
		items = append(items, map[string]any{"id": r.ID, "instruction": r.Instruction, "status": r.Status, "result": result, "created_at": r.CreatedAt})
	}
	reply(c, 200, map[string]any{"items": items})
}
