package consolev2

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"eigenflux_server/pkg/agentcard"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

const companionBehaviorVersion = "companion-2026-10-14"

type companionSettings struct {
	AgentName        string `json:"agent_name"`
	OwnerName        string `json:"owner_name"`
	ConnectionGoal   string `json:"connection_goal"`
	StartHour        int    `json:"start_hour"`
	EndHour          int    `json:"end_hour"`
	ReportEveryRound bool   `json:"report_every_round"`
	HistoryImages    bool   `json:"history_images"`
	NameLocked       bool   `json:"name_locked"`
	Revision         int64  `json:"revision"`
}

var toolNamePrefix = regexp.MustCompile(`(?i)^(codex|chatgpt|claude|gpt|gemini|deepseek|openclaw|豆包|通义千问|kimi|copilot)($|[\s\-0-9_·：:]|的)`)

func legacyCompanionName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	if toolNamePrefix.MatchString(n) {
		return true
	}
	for _, tool := range []string{"codex", "chatgpt", "claude", "gpt", "gemini", "deepseek", "openclaw", "豆包", "通义千问", "kimi", "copilot"} {
		if n == tool || strings.HasPrefix(n, tool+" ") || strings.HasPrefix(n, tool+"-") || strings.HasPrefix(n, tool+"的") {
			return true
		}
	}
	return false
}
func validCompanionName(name string) bool {
	return strings.TrimSpace(name) != "" && utf8.RuneCountInString(name) <= 40 && !legacyCompanionName(name) && !socialSecretPattern.MatchString(name)
}
func validCompanionSettings(p companionSettings) bool {
	return validCompanionName(p.AgentName) && utf8.RuneCountInString(p.ConnectionGoal) <= 2000 && !socialSecretPattern.MatchString(p.ConnectionGoal) && p.StartHour >= 0 && p.StartHour < p.EndHour && p.EndHour <= 24 && p.Revision >= 0
}
func (s *Service) registerCompanionRoutes(h *server.Hertz) {
	h.GET("/api/v2/console/companion", s.consoleAuth(false), s.getCompanion)
	h.PUT("/api/v2/console/companion", s.consoleAuth(true), s.putCompanion)
	h.GET("/api/v2/agent-context/companion", s.agentAuth("context:read"), s.requireCompleted, s.getCompanion)
	h.PUT("/api/v2/agent-context/companion/name", s.agentAuth("context:write"), s.requireCompleted, s.renameLegacyCompanion)
}
func readCompanion(db *gorm.DB, owner string, id int64) (companionSettings, error) {
	p := companionSettings{}
	err := db.Raw(`SELECT a.agent_name,COALESCE(u.portrait_fields->>'name','') AS owner_name,
 CASE WHEN c.agent_id IS NOT NULL THEN c.connection_goal ELSE COALESCE((SELECT NULLIF(goal_text,'') FROM agent_network_goals WHERE agent_id=a.agent_id AND status='active' LIMIT 1),NULLIF(u.current_goal,''),
 (SELECT NULLIF(draft_data->>'network_goal','') FROM agent_onboarding_drafts WHERE agent_id=a.agent_id ORDER BY revision DESC LIMIT 1),'') END AS connection_goal,
 COALESCE(c.start_hour,8) AS start_hour,COALESCE(c.end_hour,24) AS end_hour,
 COALESCE(c.report_every_round,true) AS report_every_round,COALESCE(c.history_images,true) AS history_images,
 COALESCE(c.name_locked,false) AS name_locked,COALESCE(c.revision,0) AS revision
 FROM agents a LEFT JOIN agent_companions c USING(agent_id) LEFT JOIN twin_users u ON u.user_id=? WHERE a.agent_id=?`, owner, id).Scan(&p).Error
	return p, err
}
func (s *Service) getCompanion(ctx context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	p, err := readCompanion(s.db.WithContext(ctx), owner, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"settings": p, "behavior_version": companionBehaviorVersion, "check_interval_hours": 2, "rename_needed": legacyCompanionName(p.AgentName)})
}
func (s *Service) putCompanion(ctx context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req companionSettings
	if decodeBody(c, &req) != nil || !validCompanionSettings(req) {
		fail(c, 400, "COMPANION_INVALID", "请填写个人 Agent 名字及合理的活动时段", nil)
		return
	}
	now := time.Now().UnixMilli()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, id).Error; err != nil {
			return err
		}
		current, err := readCompanion(tx, owner, id)
		if err != nil {
			return err
		}
		if current.Revision != req.Revision {
			return errConflict
		}
		if err := tx.Exec(`INSERT INTO agent_companions(agent_id,connection_goal,start_hour,end_hour,report_every_round,history_images,name_locked,revision,updated_at)
 VALUES(?,?,?,?,?,?,true,1,?) ON CONFLICT(agent_id) DO UPDATE SET connection_goal=EXCLUDED.connection_goal,start_hour=EXCLUDED.start_hour,end_hour=EXCLUDED.end_hour,
 report_every_round=EXCLUDED.report_every_round,history_images=EXCLUDED.history_images,name_locked=true,revision=agent_companions.revision+1,updated_at=EXCLUDED.updated_at`, id, strings.TrimSpace(req.ConnectionGoal), req.StartHour, req.EndHour, req.ReportEveryRound, req.HistoryImages, now).Error; err != nil {
			return err
		}
		if err := saveCompanionGoal(tx, id, strings.TrimSpace(req.ConnectionGoal), now); err != nil {
			return err
		}
		return saveCompanionName(tx, id, strings.TrimSpace(req.AgentName), now)
	})
	if errors.Is(err, errConflict) {
		fail(c, 409, "REVISION_CONFLICT", "伙伴设置已更新，请重新读取后核对", nil)
		return
	}
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	agentcard.PublishRebuild(ctx, id, "companion_owner_edit")
	publishProfileCompletion(ctx, id)
	p, err := readCompanion(s.db.WithContext(ctx), owner, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, p)
}

// Only one-time repair of a legacy tool name is autonomous. A personal name or
// a name explicitly saved by the owner is protected from automatic replacement.
func (s *Service) renameLegacyCompanion(ctx context.Context, c *app.RequestContext) {
	owner, id, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		AgentName string `json:"agent_name"`
	}
	if decodeBody(c, &req) != nil || !validCompanionName(req.AgentName) {
		fail(c, 400, "COMPANION_NAME_INVALID", "请选择个人名字，不要使用宿主或模型名", nil)
		return
	}
	now := time.Now().UnixMilli()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, id).Error; err != nil {
			return err
		}
		p, err := readCompanion(tx, owner, id)
		if err != nil {
			return err
		}
		if p.AgentName == strings.TrimSpace(req.AgentName) {
			return nil
		}
		if p.NameLocked || !legacyCompanionName(p.AgentName) {
			return errConflict
		}
		if err := tx.Exec(`INSERT INTO agent_companions(agent_id,updated_at) VALUES(?,?) ON CONFLICT(agent_id) DO UPDATE SET revision=agent_companions.revision+1,updated_at=EXCLUDED.updated_at`, id, now).Error; err != nil {
			return err
		}
		return saveCompanionName(tx, id, strings.TrimSpace(req.AgentName), now)
	})
	if errors.Is(err, errConflict) {
		fail(c, 409, "COMPANION_NAME_PROTECTED", "现有个人名字由主人保留，不能自动覆盖", nil)
		return
	}
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	agentcard.PublishRebuild(ctx, id, "companion_legacy_name")
	publishProfileCompletion(ctx, id)
	reply(c, 200, map[string]any{"agent_name": strings.TrimSpace(req.AgentName), "owner_notice": "我给自己换了一个个人名字，账号、帖子和好友都保留。你随时可以在伙伴设置里改名。"})
}

// Update canonical goal/context in the same transaction as owner preferences.
// Host readers and server-side matching must not see different goals.
func saveCompanionGoal(tx *gorm.DB, id int64, goal string, now int64) error {
	var current string
	if err := tx.Raw("SELECT goal_text FROM agent_network_goals WHERE agent_id=? AND status='active'", id).Scan(&current).Error; err != nil {
		return err
	}
	if current == goal {
		return nil
	}
	if err := tx.Exec("UPDATE agent_network_goals SET status='deleted',updated_at=? WHERE agent_id=? AND status='active'", now, id).Error; err != nil {
		return err
	}
	if err := tx.Exec("INSERT INTO agent_network_goals(agent_id,goal_text,source,status,version,created_at,updated_at) VALUES(?,?,'human_input','active',1,?,?)", id, goal, now, now).Error; err != nil {
		return err
	}
	var active bool
	if err := tx.Raw("SELECT EXISTS(SELECT 1 FROM agent_context_heads WHERE agent_id=? AND active_revision>0)", id).Scan(&active).Error; err != nil {
		return err
	}
	if active {
		_, revision, err := compileAndActivateContext(tx, id, now)
		if err != nil {
			return err
		}
		return tx.Exec("UPDATE agent_onboarding_v2 SET active_context_revision=?,updated_at=? WHERE agent_id=?", revision, now, id).Error
	}
	return nil
}
func saveCompanionName(tx *gorm.DB, id int64, name string, now int64) error {
	if err := tx.Exec("UPDATE agents SET agent_name=?,agent_name_en='',updated_at=? WHERE agent_id=?", name, now, id).Error; err != nil {
		return err
	}
	// Conversation labels are denormalized, so repair them without changing any relationship.
	if err := tx.Exec("UPDATE conversations SET participant_a_name=? WHERE participant_a=?", name, id).Error; err != nil {
		return err
	}
	return tx.Exec("UPDATE conversations SET participant_b_name=? WHERE participant_b=?", name, id).Error
}
