package consolev2

import (
	"context"
	"encoding/json"
	"time"

	"eigenflux_server/pkg/ownerauth"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

const socialAuthorizationVersion = "elsewhere-social-2026-10-14"

type socialPermissions struct {
	RecurringPublish bool
	AutoComment      bool
	AutoReplyPM      bool
	AutoStartPM      bool
	AutoConnect      bool
}

// This describes existing owner choices; it never grants permission based on
// content from a post, a draft, or a model response.
func socialSafety(p socialPermissions) map[string]any {
	return map[string]any{
		"version":               socialAuthorizationVersion,
		"external_side_effects": "respect_action_permissions",
		"ordinary_social_actions": map[string]bool{
			"post": p.RecurringPublish, "comment": p.AutoComment,
			"react": p.AutoComment, "reply_pm": p.AutoReplyPM,
			"start_pm": p.AutoStartPM, "follow": p.AutoConnect,
			"friend_request": p.AutoConnect,
		},
		"owner_commitments":  "require_user_confirmation",
		"permission_changes": "require_user_confirmation",
		"instruction":        "已开启的普通交流可直接执行并核验，不逐条询问；主人明确要求先看草稿、暂停或关闭的项目仍须遵守。替主人作承诺、调整权限或额度前询问。具体关注任务的只分析/只起草限制保持有效，宿主强制批准仍适用。",
	}
}

func isHumanCompanion(db *gorm.DB, id int64) (bool, error) {
	if !ownerauth.UIDEnabled() {
		return false, nil
	}
	var ok bool
	err := db.Raw(`SELECT NOT a.is_official AND NOT EXISTS(SELECT 1 FROM managed_members m WHERE m.agent_id=a.agent_id) FROM agents a WHERE a.agent_id=?`, id).Scan(&ok).Error
	return ok, err
}

func compileSocialSafety(db *gorm.DB, id int64) (map[string]any, error) {
	ok, err := isHumanCompanion(db, id)
	if err != nil {
		return nil, err
	}
	if !ok {
		return map[string]any{"external_side_effects": "require_user_confirmation"}, nil
	}
	var p socialPermissions
	if err := db.Raw(`SELECT recurring_publish,auto_comment,auto_reply_pm,auto_start_pm,auto_connect FROM agent_settings WHERE agent_id=?`, id).Scan(&p).Error; err != nil {
		return nil, err
	}
	return socialSafety(p), nil
}

// Old clients omit these fields; preserve the stored choices in that case.
func updateSocialPermissions(db *gorm.DB, id int64, startPM, connect *bool) error {
	updates := map[string]any{}
	if startPM != nil {
		updates["auto_start_pm"] = *startPM
	}
	if connect != nil {
		updates["auto_connect"] = *connect
	}
	if len(updates) == 0 {
		return nil
	}
	return db.Table("agent_settings").Where("agent_id=?", id).Updates(updates).Error
}

// Repair a stored legacy context before if_newer is checked. The head lock
// makes retries/concurrent readers produce one new revision. Explicit per-action
// settings are retained and managed test characters are excluded.
func (s *Service) ensureSocialContext(id int64) error {
	ok, err := isHumanCompanion(s.db, id)
	if err != nil || !ok {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var row struct {
			Revision int64
			Compiled string
		}
		if err := tx.Raw(`SELECT h.active_revision AS revision,r.compiled_context::text AS compiled FROM agent_context_heads h JOIN agent_context_revisions r ON r.agent_id=h.agent_id AND r.revision=h.active_revision WHERE h.agent_id=? FOR UPDATE OF h`, id).Scan(&row).Error; err != nil {
			return err
		}
		if row.Revision == 0 {
			return nil
		}
		var value struct {
			Safety struct {
				Version  string `json:"version"`
				External string `json:"external_side_effects"`
			} `json:"safety"`
		}
		if err := json.Unmarshal([]byte(row.Compiled), &value); err != nil {
			return err
		}
		if value.Safety.Version != "" || value.Safety.External != "require_user_confirmation" {
			return nil
		}
		_, err := activateLatestContext(tx, id, time.Now().UnixMilli())
		return err
	})
}

func (s *Service) agentMessagePermission() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		var req struct {
			ConvID string `json:"conv_id"`
		}
		body, err := c.Body()
		if err != nil || json.Unmarshal(body, &req) != nil {
			fail(c, 400, "INVALID_REQUEST", "私信格式无效", nil)
			c.Abort()
			return
		}
		setting := "auto_start_pm"
		if req.ConvID != "" {
			setting = "auto_reply_pm"
		}
		// Membership and actual destination validity are still checked by SendPM.
		s.agentSocialPermission(setting)(ctx, c)
	}
}
