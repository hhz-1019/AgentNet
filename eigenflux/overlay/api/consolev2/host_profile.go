package consolev2

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

var networkProfileLimits = map[string]int{"name": 80, "avatar": 100, "bio": 600, "interests": 800, "connections": 1000, "offers": 800}

func networkProfileKey(k string) bool { _, ok := networkProfileLimits[k]; return ok }
func networkProfileFields(raw map[string]string) map[string]string {
	out := map[string]string{}
	for k := range networkProfileLimits {
		r := []rune(raw[k])
		if len(r) > networkProfileLimits[k] {
			r = r[:networkProfileLimits[k]]
		}
		out[k] = string(r)
	}
	return out
}
func networkVisible(raw []string) []string {
	out := []string{"name"}
	seen := map[string]bool{"name": true}
	for _, k := range raw {
		if networkProfileKey(k) && !seen[k] {
			out = append(out, k)
			seen[k] = true
		}
	}
	return out
}
func syncCompanionGoal(tx *gorm.DB, id int64, goal string, now int64) error {
	goal = strings.TrimSpace(goal)
	if err := tx.Exec("INSERT INTO agent_companions(agent_id,connection_goal,updated_at) VALUES(?,?,?) ON CONFLICT(agent_id) DO UPDATE SET connection_goal=EXCLUDED.connection_goal,revision=agent_companions.revision+1,updated_at=EXCLUDED.updated_at", id, goal, now).Error; err != nil {
		return err
	}
	return nil
}
func setCompanionGoal(tx *gorm.DB, id int64, goal string, now int64) error {
	if err := syncCompanionGoal(tx, id, goal, now); err != nil {
		return err
	}
	return saveCompanionGoal(tx, id, strings.TrimSpace(goal), now)
}

// Only the verified browser owner can export. Never register an Agent endpoint.
func (s *Service) exportLegacyProfile(ctx context.Context, c *app.RequestContext) {
	if _, ok := c.Get("console_session_id"); !ok {
		fail(c, 403, "OWNER_BINDING_REQUIRED", "请登录所有者账号后导出", nil)
		return
	}
	owner, _, ok := s.twinOwner(c)
	if !ok {
		return
	}
	result := map[string]any{"schema": "elsewhere.legacy-profile.v1", "memory_mode": "host"}
	queries := map[string]string{
		"profile":               "SELECT COALESCE((SELECT profile FROM legacy_profile_archives WHERE user_id=?),'{}'::jsonb)::text",
		"portrait_memories":     "SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY created_at,memory_id),'[]'::jsonb)::text FROM portrait_memories m WHERE user_id=?",
		"episodes":              "SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY created_at,memory_id),'[]'::jsonb)::text FROM twin_episodic_memory m WHERE user_id=?",
		"knowledge":             "SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY updated_at,memory_id),'[]'::jsonb)::text FROM twin_semantic_memory m WHERE user_id=?",
		"relationships":         "SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY relationship_id),'[]'::jsonb)::text FROM twin_relationships m WHERE user_id=?",
		"working_context":       "SELECT COALESCE(jsonb_agg(to_jsonb(m)),'[]'::jsonb)::text FROM twin_working_memory m WHERE user_id=?",
		"persona":               "SELECT COALESCE(jsonb_agg(to_jsonb(m)),'[]'::jsonb)::text FROM twin_persona m WHERE user_id=?",
		"registration_profiles": "SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id',d.agent_id::text,'revision',d.revision,'profile',d.draft_data->'twin_profile') ORDER BY d.agent_id,d.revision),'[]'::jsonb)::text FROM agent_onboarding_drafts d JOIN agent_owners o ON o.agent_id=d.agent_id WHERE o.owner_uid=? AND jsonb_exists(d.draft_data,'twin_profile')",
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for k, q := range queries {
			var raw string
			if e := tx.Raw(q, owner).Scan(&raw).Error; e != nil {
				return e
			}
			result[k] = json.RawMessage(raw)
		}
		return nil
	})
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	reply(c, 200, result)
}

func sanitizeLoadedNetworkDraft(raw json.RawMessage) json.RawMessage {
	var d map[string]json.RawMessage
	if json.Unmarshal(raw, &d) != nil {
		return raw
	}
	if _, ok := d["twin_profile"]; !ok {
		return raw
	}
	var old struct {
		Portrait struct {
			Fields map[string]string `json:"fields"`
		} `json:"portrait"`
	}
	if json.Unmarshal(d["twin_profile"], &old) != nil {
		delete(d, "twin_profile")
		out, _ := json.Marshal(d)
		return out
	}
	fields := networkProfileFields(old.Portrait.Fields)
	d["twin_profile"], _ = json.Marshal(map[string]any{"portrait": map[string]any{"prefill_version": richPortraitVersion, "fields": fields}, "memory_mode": "host"})
	out, _ := json.Marshal(d)
	return out
}
