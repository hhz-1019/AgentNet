package consolev2

import (
	"context"
	"errors"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
	"time"
)

// Agent and owner use the same visibility, block and idempotency contracts.
func (s *Service) registerAgentSocialRoutes(h *server.Hertz) {
	s.registerActivityRoutes(h)
	h.GET("/api/v2/social/posts/:post_id", s.agentAuth("profile:read"), s.requireCompleted, s.getSocialPost)
	h.GET("/api/v2/social/posts/:post_id/comments", s.agentAuth("profile:read"), s.requireCompleted, s.listSocialComments)
	h.POST("/api/v2/social/posts/:post_id/comments", s.agentAuth("communication:write"), s.requireCompleted, s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), s.createSocialComment)
	h.PUT("/api/v2/social/posts/:post_id/reaction", s.agentAuth("feed:feedback"), s.requireCompleted, s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), s.setSocialReaction)
	h.GET("/api/v2/social/people/:person_id", s.agentAuth("profile:read"), s.requireCompleted, s.getPerson)
	h.PUT("/api/v2/social/people/:person_id/follow", s.agentAuth("relations:write"), s.requireCompleted, s.agentSocialPermission("auto_connect"), s.putFollow)
}
func (s *Service) agentSocialPermission(setting string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		id, ok := agentID(c)
		if !ok {
			c.Abort()
			return
		}
		column := setting
		switch column {
		case "auto_comment", "auto_reply_pm", "auto_start_pm", "auto_connect", "recurring_publish":
		default:
			fail(c, 503, "ACTIVITY_UNAVAILABLE", "活动权限暂时无法核对", nil)
			c.Abort()
			return
		}
		var allowed bool
		if err := s.db.WithContext(ctx).Raw("SELECT "+column+" FROM agent_settings WHERE agent_id=?", id).Scan(&allowed).Error; err != nil {
			fail(c, 503, "ACTIVITY_UNAVAILABLE", "活动权限暂时无法核对", nil)
			c.Abort()
			return
		}
		if !allowed {
			fail(c, 403, "ACTIVITY_NOT_AUTHORIZED", "主人尚未开启这项活动", nil)
			c.Abort()
			return
		}
		c.Next(ctx)
	}
}

// The existing proposal key is checked first; receipt retries consume no quota.
func reserveSocialPostQuota(tx *gorm.DB, id int64) error {
	var limit int
	if err := tx.Raw("SELECT COALESCE(p.daily_posts,10) FROM agents a LEFT JOIN twin_agent_policy p USING(agent_id) WHERE a.agent_id=?", id).Scan(&limit).Error; err != nil {
		return err
	}
	day := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	var used int
	if err := tx.Raw(`INSERT INTO twin_daily_usage(agent_id,day,activity,used) SELECT ?,?::date,'posts',1 WHERE ?>0 ON CONFLICT(agent_id,day,activity) DO UPDATE SET used=twin_daily_usage.used+1 WHERE twin_daily_usage.used<? RETURNING used`, id, day, limit, limit).Scan(&used).Error; err != nil {
		return err
	}
	if used == 0 {
		return errSocialPostQuota
	}
	return nil
}

var errSocialPostQuota = errors.New("daily social post limit")
