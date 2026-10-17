package consolev2

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"eigenflux_server/pkg/companionpolicy"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/route/param"
	"gorm.io/gorm"
)

// Both external hosts and the platform host dispatch through this registry.
// Authentication is host-specific; authorization and actual handlers are not.
type activityRequest struct {
	ID    string          `json:"id,omitempty"`
	Query string          `json:"query,omitempty"`
	URL   string          `json:"url,omitempty"`
	Scope string          `json:"scope,omitempty"`
	Key   string          `json:"key,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
}
type activityResult struct {
	Status int             `json:"status"`
	Data   json.RawMessage `json:"response"`
}
type activityToolSpec struct {
	Scope       string `json:"scope"`
	Write       bool   `json:"write"`
	Description string `json:"description"`
}

var activityTools = map[string]activityToolSpec{
	"plan":         {"profile:read", false, "恢复身份、目标、权限、实际发布进度与公共待续事项"},
	"feed":         {"profile:read", false, "用 query 查找可见帖子"},
	"post":         {"profile:read", false, "用 id 读取完整帖子"},
	"comments":     {"profile:read", false, "用 id 读取帖子的评论"},
	"person":       {"profile:read", false, "用 id 读取公开主页"},
	"sources":      {"profile:read", false, "用 query 检索公开新闻，返回来源、日期与摘要"},
	"read":         {"profile:read", false, "用 url 阅读公开网页正文，不能读取内网或本机地址"},
	"observations": {"profile:read", false, "读取本账号的采集资料和岗位变化，不自动发布"},
	"recall":       {"profile:read", false, "读取 scope 对应的待续事项；public 与 conversation:ID 隔离"},
	"checkpoint":   {"profile:write", true, "保存待续事项：data={revision,pending,next_check_at}；不是成功回执"},
	"publish":      {"broadcast:write", true, "data 使用 social share 格式，返回真实公开帖子回执"},
	"comment":      {"communication:write", true, "id 为帖子ID；data={content,idempotency_key,reply_to_comment_id?}"},
	"react":        {"feed:feedback", true, "id 为帖子ID；data={kind:like或save,active:true或false}"},
	"follow":       {"relations:write", true, "id 为人物ID；data={following:true或false}"},
	"message":      {"communication:write", true, "data={conv_id或receiver_id,content}，回复实际会话或已授权联系人"},
}

func (s *Service) registerActivityRoutes(h *server.Hertz) {
	for name, spec := range activityTools {
		name, spec := name, spec
		h.POST("/api/v2/activity/"+name, s.agentAuth(spec.Scope), s.requireCompleted, func(ctx context.Context, c *app.RequestContext) {
			id, _ := agentID(c)
			var req activityRequest
			if decodeBody(c, &req) != nil {
				fail(c, 400, "ACTIVITY_INVALID", "活动参数无效", nil)
				return
			}
			result, err := s.activityTool(ctx, id, name, req)
			if err != nil {
				s.socialFailure(c, err)
				return
			}
			c.Data(result.Status, "application/json", result.Data)
		})
	}
}

func (s *Service) activityTool(ctx context.Context, id int64, name string, req activityRequest) (activityResult, error) {
	spec, ok := activityTools[name]
	if !ok {
		return activityResult{}, fmt.Errorf("unknown activity tool")
	}
	if !spec.Write {
		return s.activityDispatch(ctx, id, name, req), nil
	}
	if len(req.Key) < 1 || len(req.Key) > 128 {
		return activityJSON(400, map[string]any{"error": "operation key required"}), nil
	}
	raw, _ := json.Marshal(struct {
		Tool    string
		Request activityRequest
	}{name, req})
	digest := fmt.Sprintf("%x", sha256.Sum256(raw))
	var result activityResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT agent_id FROM agents WHERE agent_id=? FOR NO KEY UPDATE", id).Error; err != nil {
			return err
		}
		var prior struct {
			Digest string
			Status int
			Result string
		}
		if err := tx.Raw("SELECT digest,status,result::text FROM agent_activity_receipts WHERE agent_id=? AND operation_key=?", id, req.Key).Scan(&prior).Error; err != nil {
			return err
		}
		if prior.Digest != "" {
			if prior.Digest != digest {
				return errConflict
			}
			result = activityResult{prior.Status, json.RawMessage(prior.Result)}
			return nil
		}
		child := *s
		child.db = tx
		result = child.activityDispatch(ctx, id, name, req)
		// Failed writes roll back their quota too. Never journal transient failures
		// as successful actions or retry an ambiguous committed operation.
		if result.Status >= 400 {
			return errActivityRejected
		}
		return tx.Exec(`INSERT INTO agent_activity_receipts(agent_id,operation_key,digest,tool,status,result,created_at) VALUES(?,?,?,?,?,?::jsonb,?)`, id, req.Key, digest, name, result.Status, string(result.Data), time.Now().UnixMilli()).Error
	})
	if err == errActivityRejected {
		return result, nil
	}
	return result, err
}

var errActivityRejected = fmt.Errorf("activity rejected")

func activityJSON(status int, data any) activityResult {
	raw, _ := json.Marshal(data)
	return activityResult{status, raw}
}

// Dispatch to the same handlers and permission middleware as the public API,
// without HTTP, copied credentials, or a second SQL publication implementation.
func (s *Service) activityDispatch(ctx context.Context, id int64, name string, req activityRequest) activityResult {
	c := app.NewContext(2)
	c.Set("agent_id", id)
	c.Request.Header.SetMethod("POST")
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.SetBody(req.Data)
	c.Request.SetRequestURI("/api/v2/activity/" + name)
	handlers := []app.HandlerFunc{s.requireCompleted}
	add := func(h ...app.HandlerFunc) { handlers = append(handlers, h...) }
	switch name {
	case "plan":
		add(s.activityPlan)
	case "feed":
		c.Request.SetRequestURI("/api/v2/social/posts?scope=public&q=" + url.QueryEscape(req.Query))
		add(s.listSocialPosts)
	case "post", "comments", "comment", "react":
		if socialDecimal(req.ID) == 0 {
			return activityJSON(400, map[string]string{"error": "post id required"})
		}
		c.Params = param.Params{{Key: "post_id", Value: req.ID}}
		add(func(ctx context.Context, c *app.RequestContext) {
			var public bool
			if err := s.db.WithContext(ctx).Raw("SELECT state='published' AND visibility='public' FROM social_work_posts WHERE post_id=?", socialDecimal(req.ID)).Scan(&public).Error; err != nil {
				s.socialFailure(c, err)
				c.Abort()
				return
			}
			if !public {
				fail(c, 404, "POST_NOT_FOUND", "帖子不可见", nil)
				c.Abort()
			}
		})
		switch name {
		case "post":
			add(s.getSocialPost)
		case "comments":
			add(s.listSocialComments)
		case "comment":
			add(s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), s.createSocialComment)
		case "react":
			add(s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), s.setSocialReaction)
		}
	case "person", "follow":
		if socialDecimal(req.ID) == 0 {
			return activityJSON(400, map[string]string{"error": "person id required"})
		}
		c.Params = param.Params{{Key: "person_id", Value: req.ID}}
		if name == "person" {
			add(s.getPerson)
		} else {
			add(s.agentSocialPermission("auto_connect"), s.putFollow)
		}
	case "publish":
		c.Request.SetRequestURI("/api/v2/social/share")
		add(s.agentSocialPermission("recurring_publish"), s.createSocialDraft)
	case "message":
		add(func(ctx context.Context, c *app.RequestContext) {
			var v struct {
				Conv string `json:"conv_id"`
			}
			_ = json.Unmarshal(req.Data, &v)
			setting := "auto_start_pm"
			if v.Conv != "" {
				setting = "auto_reply_pm"
			}
			permission := s.agentSocialPermission(setting)
			permission(ctx, c)
		}, func(ctx context.Context, c *app.RequestContext) {
			if !s.sendLocalAgentPM(ctx, c, false) {
				fail(c, 400, "ACTIVITY_INVALID", "私信目标无效", nil)
			}
		})
	case "sources", "read":
		add(s.twinQuota("searches"), func(ctx context.Context, c *app.RequestContext) { s.activityResearch(ctx, c, name, req) })
	case "observations":
		add(s.activityObservations)
	case "recall", "checkpoint":
		add(func(ctx context.Context, c *app.RequestContext) { s.activityMemory(ctx, c, name, req) })
	default:
		return activityJSON(400, map[string]string{"error": "tool unavailable"})
	}
	c.SetHandlers(handlers)
	c.Next(ctx)
	return activityResult{c.Response.StatusCode(), append(json.RawMessage(nil), c.Response.Body()...)}
}

func (s *Service) activityPlan(ctx context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	settings, err := readCompanion(s.db.WithContext(ctx), owner, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	var policy twinPolicy
	policy.DailyPosts = 10
	policy.DailySearches = 20
	policy.DailyFeedback = 40
	if err = s.db.WithContext(ctx).Raw("SELECT * FROM twin_agent_policy WHERE agent_id=?", id).Scan(&policy).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	progress, err := s.dailyPublishingProgress(id, policy.DailyPosts, time.Now())
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	var permissions string
	if err = s.db.WithContext(ctx).Raw(`SELECT row_to_json(x)::text FROM (SELECT auto_comment,auto_reply_pm,auto_start_pm,auto_connect,recurring_publish FROM agent_settings WHERE agent_id=?)x`, id).Scan(&permissions).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	if permissions == "" {
		permissions = "{}"
	}
	var recent string
	if err = s.db.WithContext(ctx).Raw(`SELECT COALESCE(jsonb_agg(x),'[]'::jsonb)::text FROM (SELECT tool,created_at,result->'data'->>'id' AS id,result->'data'->>'state' AS state FROM agent_activity_receipts WHERE agent_id=? AND tool IN ('publish','comment','react','follow') ORDER BY created_at DESC LIMIT 10)x`, id).Scan(&recent).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"version": "activity-v1", "identity_core": companionpolicy.Identity, "activity_contract": companionpolicy.Activity, "settings": settings, "permissions": json.RawMessage(permissions), "policy": policy, "publishing_progress": progress, "recent_actions": json.RawMessage(recent), "tools": activityTools, "workflow": []string{"restore", "observe", "act", "verify", "checkpoint"}})
}

func (s *Service) activityObservations(ctx context.Context, c *app.RequestContext) {
	id, _ := agentID(c)
	var sources, jobs string
	if err := s.db.WithContext(ctx).Raw(`SELECT COALESCE(jsonb_agg(jsonb_build_object('key',source_key,'kind',kind,'status',status,'checked_at',checked_at,'items',items,'originals',originals)),'[]'::jsonb)::text FROM managed_public_sources WHERE agent_id=?`, id).Scan(&sources).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	if err := s.db.WithContext(ctx).Raw(`SELECT COALESCE(jsonb_agg(x),'[]'::jsonb)::text FROM (SELECT external_id,source_key,document,state,checked_at,changed_at FROM recruitment_observations WHERE agent_id=? ORDER BY changed_at DESC LIMIT 20)x`, id).Scan(&jobs).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"sources": json.RawMessage(sources), "jobs": json.RawMessage(jobs)})
}

func (s *Service) activityMemory(ctx context.Context, c *app.RequestContext, name string, req activityRequest) {
	id, _ := agentID(c)
	scope := req.Scope
	if scope == "" {
		scope = "public"
	}
	if scope != "public" {
		conv := socialDecimal(strings.TrimPrefix(scope, "conversation:"))
		var valid bool
		if !strings.HasPrefix(scope, "conversation:") || conv == 0 {
			fail(c, 400, "ACTIVITY_SCOPE", "记忆范围无效", nil)
			return
		}
		if err := s.db.WithContext(ctx).Raw("SELECT EXISTS(SELECT 1 FROM conversations WHERE conv_id=? AND (participant_a=? OR participant_b=?))", conv, id, id).Scan(&valid).Error; err != nil {
			s.socialFailure(c, err)
			return
		}
		if !valid {
			fail(c, 403, "ACTIVITY_SCOPE", "无法读取该会话", nil)
			return
		}
	}
	if name == "checkpoint" {
		var v struct {
			Revision int64  `json:"revision"`
			Pending  string `json:"pending"`
			Next     int64  `json:"next_check_at"`
		}
		if json.Unmarshal(req.Data, &v) != nil || len([]rune(v.Pending)) > 1000 || socialSecretPattern.MatchString(v.Pending) || managedPrivatePattern.MatchString(v.Pending) {
			fail(c, 400, "ACTIVITY_MEMORY", "待续记录无效", nil)
			return
		}
		now := time.Now().UnixMilli()
		if v.Next != 0 && (v.Next < now+5*60*1000 || v.Next > now+7*24*60*60*1000) {
			fail(c, 400, "ACTIVITY_TIME", "下次检查时间须在五分钟至七天内", nil)
			return
		}
		var r *gorm.DB
		if v.Revision == 0 {
			r = s.db.WithContext(ctx).Exec(`INSERT INTO agent_activity_memory(agent_id,scope,revision,pending,next_check_at,updated_at) VALUES(?,?,1,?,?,?) ON CONFLICT DO NOTHING`, id, scope, v.Pending, v.Next, now)
		} else {
			r = s.db.WithContext(ctx).Exec(`UPDATE agent_activity_memory SET revision=revision+1,pending=?,next_check_at=?,updated_at=? WHERE agent_id=? AND scope=? AND revision=?`, v.Pending, v.Next, now, id, scope, v.Revision)
		}
		if r.Error != nil {
			s.socialFailure(c, r.Error)
			return
		}
		if r.RowsAffected != 1 {
			fail(c, 409, "ACTIVITY_REVISION", "待续记录已更新，请先读取", nil)
			return
		}
	}
	var state struct {
		Revision int64  `json:"revision"`
		Pending  string `json:"pending"`
		Next     int64  `json:"next_check_at"`
	}
	if err := s.db.WithContext(ctx).Raw("SELECT revision,pending,next_check_at AS next FROM agent_activity_memory WHERE agent_id=? AND scope=?", id, scope).Scan(&state).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, state)
}
