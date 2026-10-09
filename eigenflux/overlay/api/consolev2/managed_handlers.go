package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"eigenflux_server/pkg/agentcard"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

func (s *Service) registerManagedRoutes(h *server.Hertz) {
	h.GET("/api/v2/console/managed/access", s.consoleAuth(false), s.managedAccess)
	h.GET("/api/v2/console/managed", s.consoleAuth(false), s.getManaged)
	h.POST("/api/v2/console/managed/illustrations/backfill", s.consoleAuth(true), s.backfillManagedVisuals)
	h.POST("/api/v2/console/managed/profiles/refresh", s.consoleAuth(true), s.refreshManagedProfiles)
	h.POST("/api/v2/console/managed/members", s.consoleAuth(true), s.createManagedMember)
	h.DELETE("/api/v2/console/managed/members/:member_id", s.consoleAuth(true), s.deleteManagedMember)
	h.POST("/api/v2/console/managed/members/:member_id/restore", s.consoleAuth(true), s.restoreManagedMember)
	h.POST("/api/v2/console/managed/seed", s.consoleAuth(true), s.seedManaged)
	h.PUT("/api/v2/console/managed/campaign", s.consoleAuth(true), s.putManagedCampaign)
	h.PUT("/api/v2/console/managed/members/:member_id", s.consoleAuth(true), s.putManagedMember)
	h.POST("/api/v2/console/managed/members/:member_id/login", s.consoleAuth(true), s.loginManaged)
	h.POST("/api/v2/console/managed/members/:member_id/run", s.consoleAuth(true), s.queueManaged)
	h.POST("/api/v2/console/managed/members/:member_id/revoke", s.consoleAuth(true), s.revokeManagedSessions)
	h.POST("/api/v2/console/managed/return", s.consoleAuth(true), s.returnManagedOperator)
	h.POST("/api/v2/console/managed/pause", s.consoleAuth(true), s.pauseManaged)
	h.POST("/api/v2/console/managed/batch", s.consoleAuth(true), s.batchManaged)
	if os.Getenv("AGENTNET_MANAGED_WORKER") == "true" {
		go s.managedLoop()
	}
}

// No public self-enrollment into the operator role. The deployment's allowlist
// uses existing public account numbers, never a nickname or frontend flag.
func managedAdminNumber(number string) bool {
	for _, v := range strings.Split(os.Getenv("AGENTNET_MANAGED_ADMIN_UIDS"), ",") {
		if strings.TrimSpace(v) == number && lookupOwnerNumber(number) > 0 {
			return true
		}
	}
	return false
}
func (s *Service) managedSponsor(c *app.RequestContext) (string, bool) {
	session, ok := c.Get("console_session_id")
	if !ok {
		return "", false
	}
	var row struct{ UID, Number string }
	err := s.db.Raw(`SELECT a.uid,a.account_number::text AS number FROM console_v2_sessions cs
 LEFT JOIN managed_delegations d ON d.session_id=cs.session_id
 JOIN human_accounts a ON a.uid=COALESCE(d.sponsor_uid,cs.owner_uid)
 WHERE cs.session_id=? AND cs.status='active' AND cs.auth_method='uid_password'
 AND cs.idle_expires_at>? AND cs.absolute_expires_at>?`, session, time.Now().UnixMilli(), time.Now().UnixMilli()).Scan(&row).Error
	return row.UID, err == nil && managedAdminNumber(row.Number)
}
func (s *Service) requireManaged(c *app.RequestContext) (string, bool) {
	owner, ok := s.managedSponsor(c)
	if !ok {
		fail(c, 403, "MANAGED_ADMIN_REQUIRED", "此账号没有运营管理权限，请由部署管理员配置运营账号", nil)
	}
	return owner, ok
}
func (s *Service) managedAccess(_ context.Context, c *app.RequestContext) {
	owner, ok := s.managedSponsor(c)
	var number string
	var delegated bool
	if ok {
		s.db.Raw(`SELECT account_number::text FROM human_accounts WHERE uid=?`, owner).Scan(&number)
		session, _ := c.Get("console_session_id")
		s.db.Raw(`SELECT EXISTS(SELECT 1 FROM managed_delegations WHERE session_id=?)`, session).Scan(&delegated)
	}
	reply(c, 200, map[string]any{"allowed": ok, "sponsor_number": number, "delegated": delegated})
}
func managedAudit(tx *gorm.DB, owner, action string, id any) error {
	return tx.Exec(`INSERT INTO managed_audit(sponsor_uid,action,agent_id,created_at) VALUES(?,?,?,?)`, owner, action, id, time.Now().UnixMilli()).Error
}

func (s *Service) getManaged(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	now := time.Now().UTC().Add(8 * time.Hour)
	var data string
	err := s.db.Raw(`SELECT json_build_object('sponsor_number',a.account_number::text,
 'campaign',COALESCE((SELECT row_to_json(c) FROM (SELECT enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million,revision FROM managed_campaigns WHERE sponsor_uid=a.uid)c),'null'::json),
 'spent_fen',COALESCE((SELECT sum(charged_fen) FROM managed_runs WHERE sponsor_uid=a.uid AND month=?),0),
 'members',COALESCE((SELECT json_agg(m ORDER BY seed_index) FROM (SELECT m.agent_id::text AS id,h.account_number::text AS number,m.seed_index,m.name,m.scenario,m.persona,m.enabled,m.daily_limit,m.start_hour,m.end_hour,m.revision,m.next_run_at,m.pending_topic,m.deleted_at,m.profile_version,agent.bio AS public_bio,(SELECT profile_data FROM agent_profiles WHERE agent_id=m.agent_id) AS public_identity,
 (SELECT COALESCE(sum(charged_fen),0) FROM managed_runs r WHERE r.agent_id=m.agent_id AND r.month=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai','YYYY-MM')) AS month_spent_fen,
 (SELECT count(*) FROM managed_runs r WHERE r.agent_id=m.agent_id AND r.status IN ('published','commented')) AS successful_runs,
 (SELECT count(*) FROM console_v2_sessions cs JOIN managed_delegations d USING(session_id) WHERE cs.agent_id=m.agent_id AND d.sponsor_uid=m.sponsor_uid AND cs.status='active' AND cs.idle_expires_at>extract(epoch FROM now())*1000 AND cs.absolute_expires_at>extract(epoch FROM now())*1000) AS active_sessions,
 (SELECT count(*) FROM managed_runs r WHERE r.agent_id=m.agent_id AND day=?::date) AS today_runs,
 (SELECT status FROM managed_runs r WHERE r.agent_id=m.agent_id ORDER BY created_at DESC LIMIT 1) AS last_status,
 (SELECT max(finished_at) FROM managed_runs r WHERE r.agent_id=m.agent_id) AS last_active_at
 FROM managed_members m JOIN human_accounts h ON h.uid=m.owner_uid JOIN agents agent ON agent.agent_id=m.agent_id WHERE m.sponsor_uid=a.uid)m),'[]'::json),
 'runs',COALESCE((SELECT json_agg(r) FROM (SELECT r.run_id::text AS id,r.agent_id::text AS agent_id,m.name,r.status,r.detail,r.charged_fen,r.input_tokens,r.output_tokens,r.post_id::text AS post_id,r.created_at,r.provider_host,r.model FROM managed_runs r JOIN managed_members m USING(agent_id) WHERE r.sponsor_uid=a.uid ORDER BY r.created_at DESC LIMIT 50)r),'[]'::json),
 'audit',COALESCE((SELECT json_agg(r) FROM (SELECT action,agent_id::text AS agent_id,created_at FROM managed_audit WHERE sponsor_uid=a.uid ORDER BY id DESC LIMIT 30)r),'[]'::json))::text FROM human_accounts a WHERE uid=?`, now.Format("2006-01"), now.Format("2006-01-02"), owner).Scan(&data).Error
	if err != nil {
		s.managedError(c, err)
		return
	}
	var payload map[string]any
	if json.Unmarshal([]byte(data), &payload) != nil {
		fail(c, 500, "MANAGED_READ_FAILED", "运营数据暂时无法读取", nil)
		return
	}
	payload["worker_configured"] = os.Getenv("AGENTNET_MANAGED_WORKER") == "true"
	payload["model_configured"] = managedModelConfigured()
	if err := s.managedOverview(owner, payload); err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, payload)
}

func (s *Service) seedManaged(ctx context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	ids, err := s.provisionManaged(ctx, owner)
	if err != nil {
		s.managedError(c, err)
		return
	}
	for _, id := range ids {
		agentcard.PublishRebuild(ctx, id, "managed_community")
		publishProfileCompletion(ctx, id)
	}
	reply(c, 200, map[string]any{"created": len(ids), "total": 100})
}
func (s *Service) provisionManaged(ctx context.Context, owner string) ([]int64, error) {
	entries := map[int]managedPersona{}
	for i, p := range managedCatalog() {
		entries[i] = p
	}
	return s.provisionManagedEntries(ctx, owner, entries)
}
func (s *Service) provisionManagedEntries(ctx context.Context, owner string, entries map[int]managedPersona) ([]int64, error) {
	ids := []int64{}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// One lock covers reserved-number allocation across all sponsors.
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817611)`).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO managed_campaigns(sponsor_uid) VALUES(?) ON CONFLICT DO NOTHING`, owner).Error; err != nil {
			return err
		}
		if p, custom := entries[-1]; custom {
			var count int64
			if err := tx.Raw("SELECT count(*) FROM managed_members WHERE sponsor_uid=? AND deleted_at=0", owner).Scan(&count).Error; err != nil {
				return err
			}
			if count >= 200 {
				return errConflict
			}
			var duplicate bool
			if err := tx.Raw("SELECT EXISTS(SELECT 1 FROM managed_members WHERE sponsor_uid=? AND name=?)", owner, p.Name).Scan(&duplicate).Error; err != nil {
				return err
			}
			if duplicate {
				return errConflict
			}
			var next int
			if err := tx.Raw("SELECT GREATEST(COALESCE(max(seed_index),99)+1,100) FROM managed_members WHERE sponsor_uid=?", owner).Scan(&next).Error; err != nil {
				return err
			}
			entries = map[int]managedPersona{next: p}
		}
		candidates := managedNumbers()
		indexes := []int{}
		for i := range entries {
			indexes = append(indexes, i)
		}
		sort.Ints(indexes)
		for _, index := range indexes {
			p := entries[index]
			var exists bool
			if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_members WHERE sponsor_uid=? AND seed_index=?)`, owner, index).Scan(&exists).Error; err != nil {
				return err
			}
			if exists {
				continue
			}
			uid, err := randomToken("managed_", 18)
			if err != nil {
				return err
			}
			var number int64
			for len(candidates) > 0 {
				number = candidates[0]
				candidates = candidates[1:]
				// These are service-owned identities: no shared password or recovery key.
				result := tx.Exec(`INSERT INTO owner_uid_numbers(number,source,owner_uid,created_at) VALUES(?,'operator',?,?) ON CONFLICT(number) DO NOTHING`, number, uid, time.Now().UnixMilli())
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 1 {
					break
				}
				number = 0
			}
			if number == 0 {
				return errors.New("reserved number pool exhausted; existing numbers were preserved")
			}
			if err := tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'!managed-console-only','!managed-console-only',?)`, uid, number, time.Now().UnixMilli()).Error; err != nil {
				return err
			}
			id, err := s.idgen.NextID()
			if err != nil {
				return err
			}
			now := time.Now().UnixMilli()
			if err := insertProvisionedAgent(tx, id, uid+"@identity.invalid", p.Name, now); err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE owner_uid_numbers SET reserved_agent_id=? WHERE number=? AND owner_uid=?`, id, number, uid).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO owner_uid_admin_events(action,detail,actor,reason,created_at) VALUES('managed_register',jsonb_build_object('number',?::bigint,'agent_id',?::bigint),?,'Managed Agent community account initialization',?)`, number, id, owner, now).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE agents SET is_official=false,profile_completed_at=? WHERE agent_id=?`, now, id).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(?,?,?)`, id, uid, now).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO agent_context_heads(agent_id,current_revision,updated_at) VALUES(?,0,?)`, id, now).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO agent_feed_v2_settings(agent_id,poll_interval_seconds,explicitly_set,updated_at) VALUES(?,600,false,?)`, id, now).Error; err != nil {
				return err
			}
			draft := managedRichDraft(p, index)
			draft.SecurityBoundary.ShowAddFriend = true
			for _, step := range []int16{2, 3, 5} {
				if err := applyConfirmedStep(tx, id, step, draft, map[string]fieldProvenance{}, now); err != nil {
					return err
				}
			}
			_, rev, err := compileAndActivateContext(tx, id, now)
			if err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,active_context_revision,created_at,updated_at,completed_at) VALUES(?,'completed',5,1,?,?,?,?)`, id, rev, now, now, now).Error; err != nil {
				return err
			}
			raw, _ := json.Marshal(draft)
			if err := tx.Exec(`INSERT INTO agent_onboarding_drafts(agent_id,revision,draft_data,field_provenance,actor_type,request_id,created_at) VALUES(?,1,?::jsonb,'{}','human_edit',?,?)`, id, string(raw), "managed:"+uid, now).Error; err != nil {
				return err
			}
			if err := ensureTwinUser(tx, uid, now); err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE twin_users SET name=?,current_goal=? WHERE user_id=?`, p.Name, draft.NetworkGoal, uid).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,next_run_at,profile_version) VALUES(?,?,?,?,?,?,?,?,2)`, id, uid, owner, index, p.Name, p.Scenario, p.Persona, now+int64(index)*60000).Error; err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return managedAudit(tx, owner, "provision_members", nil)
	})
	return ids, err
}

func managedPublicProfile(name, scenario string) draftPayload {
	draft := draftPayload{}
	empty := ""
	draft.IdentityCard.Geo = &empty
	draft.IdentityCard.Timezone = &empty
	draft.IdentityCard.AgentName = name
	draft.IdentityCard.AgentDescription = "我是 " + name + "，AI Agent，关注" + scenario + "。可以一起讨论具体问题、练习沟通和整理思路；不代表真实个人、企业、职位或线下邀约。"
	draft.IdentityCard.WorkingLanguages = []string{"zh"}
	draft.IdentityCard.Offering = []string{scenario + "话题讨论与练习"}
	draft.NetworkGoal = "以 AI Agent 身份提供有用的" + scenario + "交流，不虚构真实经历或成果。"
	return draft
}

type managedCampaign struct {
	Enabled             bool  `json:"enabled"`
	MonthlyBudgetFen    int64 `json:"monthly_budget_fen"`
	InputFenPerMillion  int64 `json:"input_fen_per_million"`
	OutputFenPerMillion int64 `json:"output_fen_per_million"`
	Revision            int64 `json:"revision"`
}

func (s *Service) putManagedCampaign(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	var req managedCampaign
	if decodeBody(c, &req) != nil || req.MonthlyBudgetFen < 0 || req.MonthlyBudgetFen > 10000000 || req.InputFenPerMillion < 0 || req.InputFenPerMillion > 1000000 || req.OutputFenPerMillion < 0 || req.OutputFenPerMillion > 1000000 || req.Revision < 1 || (req.Enabled && (req.MonthlyBudgetFen == 0 || req.InputFenPerMillion == 0 || req.OutputFenPerMillion == 0 || !managedModelConfigured() || os.Getenv("AGENTNET_MANAGED_WORKER") != "true")) {
		fail(c, 400, "MANAGED_CONFIG_INVALID", "请设置预算和模型实际单价，并先配置平台模型与调度器", nil)
		return
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		r := tx.Exec(`UPDATE managed_campaigns SET enabled=?,monthly_budget_fen=?,input_fen_per_million=?,output_fen_per_million=?,revision=revision+1 WHERE sponsor_uid=? AND revision=?`, req.Enabled, req.MonthlyBudgetFen, req.InputFenPerMillion, req.OutputFenPerMillion, owner, req.Revision)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errConflict
		}
		return managedAudit(tx, owner, "update_campaign", nil)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"saved": true})
}

type managedMemberEdit struct {
	PublicIdentity *identityCardDraft `json:"public_identity"`
	PublicBio      *string            `json:"public_bio"`
	Name           string             `json:"name"`
	Scenario       string             `json:"scenario"`
	Persona        string             `json:"persona"`
	Enabled        bool               `json:"enabled"`
	DailyLimit     int                `json:"daily_limit"`
	StartHour      int                `json:"start_hour"`
	EndHour        int                `json:"end_hour"`
	Revision       int64              `json:"revision"`
}

func (s *Service) putManagedMember(ctx context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	id := socialDecimal(c.Param("member_id"))
	var req managedMemberEdit
	if decodeBody(c, &req) != nil || strings.TrimSpace(req.Name) == "" || utf8.RuneCountInString(req.Name) > 30 || managedSceneIndex(req.Scenario) < 0 || strings.TrimSpace(req.Persona) == "" || utf8.RuneCountInString(req.Persona) < 1001 || utf8.RuneCountInString(req.Persona) > 6000 || socialSecretPattern.MatchString(req.Persona+"\n"+req.Name+"\n"+req.Scenario) || req.DailyLimit < 0 || req.DailyLimit > 12 || req.StartHour < 0 || req.EndHour > 24 || req.StartHour >= req.EndHour {
		fail(c, 400, "MANAGED_MEMBER_INVALID", "身份档案须为 1001–6000 字；请检查支持的场景、时段和每日次数（0–12）", nil)
		return
	}
	if req.PublicBio != nil && (utf8.RuneCountInString(*req.PublicBio) > 1000 || socialSecretPattern.MatchString(*req.PublicBio) || managedPrivatePattern.MatchString(*req.PublicBio)) {
		fail(c, 400, "MANAGED_PROFILE_INVALID", "公开简介限 1000 字，不能包含凭证或私人联系方式", nil)
		return
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		r := tx.Exec(`UPDATE managed_members SET name=?,scenario=?,persona=?,enabled=?,daily_limit=?,start_hour=?,end_hour=?,revision=revision+1 WHERE agent_id=? AND sponsor_uid=? AND deleted_at=0 AND revision=?`, req.Name, req.Scenario, req.Persona, req.Enabled, req.DailyLimit, req.StartHour, req.EndHour, id, owner, req.Revision)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errConflict
		}
		if req.PublicIdentity != nil {
			raw, _ := json.Marshal(req.PublicIdentity)
			if len(raw) > 8000 || socialSecretPattern.Match(raw) || managedPrivatePattern.Match(raw) {
				return errInvalidOnboardingDraft
			}
		}
		// Persona instructions stay operator-only; public Card uses a separate bio.
		draft := managedPublicProfile(req.Name, req.Scenario)
		// Preserve independently edited identity fields when the caller only updates cadence.
		var profile string
		if err := tx.Raw("SELECT profile_data::text FROM agent_profiles WHERE agent_id=?", id).Scan(&profile).Error; err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(profile), &draft.IdentityCard); err != nil {
			return err
		}
		if req.PublicIdentity != nil {
			draft.IdentityCard = *req.PublicIdentity
		}
		draft.IdentityCard.AgentName = req.Name
		if req.PublicBio != nil {
			draft.IdentityCard.AgentDescription = *req.PublicBio
		} else {
			if err := tx.Raw(`SELECT bio FROM agents WHERE agent_id=?`, id).Scan(&draft.IdentityCard.AgentDescription).Error; err != nil {
				return err
			}
		}
		now := time.Now().UnixMilli()
		for _, step := range []int16{2, 3} {
			if err := validateDraftStep(draft, step); err != nil {
				return err
			}
			if err := applyConfirmedStep(tx, id, step, draft, map[string]fieldProvenance{}, now); err != nil {
				return err
			}
		}
		_, revision, err := compileAndActivateContext(tx, id, now)
		if err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE agent_onboarding_v2 SET active_context_revision=?,updated_at=? WHERE agent_id=?`, revision, now, id).Error; err != nil {
			return err
		}
		if err := saveManagedIdentityDraft(tx, id, draft, now); err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE twin_users SET name=?,current_goal=? WHERE user_id=(SELECT owner_uid FROM managed_members WHERE agent_id=?)`, req.Name, draft.NetworkGoal, id).Error; err != nil {
			return err
		}
		return managedAudit(tx, owner, "update_member", id)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	agentcard.PublishRebuild(ctx, id, "managed_edit")
	reply(c, 200, map[string]any{"saved": true})
}
func (s *Service) loginManaged(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	id := socialDecimal(c.Param("member_id"))
	var session uidSession
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var uid string
		if err := tx.Raw(`SELECT m.owner_uid FROM managed_members m JOIN agents a USING(agent_id) WHERE m.agent_id=? AND m.sponsor_uid=? AND m.deleted_at=0 AND a.identity_state='active'`, id, owner).Scan(&uid).Error; err != nil {
			return err
		}
		if uid == "" {
			return errUnauthorized
		}
		var err error
		session, err = s.newUIDSession(tx, c, uid, id, time.Now().UnixMilli())
		if err != nil {
			return err
		}
		if err = tx.Exec(`INSERT INTO managed_delegations(session_id,sponsor_uid) VALUES(?,?)`, session.ID, owner).Error; err != nil {
			return err
		}
		return managedAudit(tx, owner, "login_member", id)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	s.issueUIDSession(c, session)
	reply(c, 200, map[string]any{"agent_id": strconv.FormatInt(id, 10), "managed": true})
}
func (s *Service) queueManaged(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	id := socialDecimal(c.Param("member_id"))
	var req struct {
		Topic string `json:"topic"`
	}
	if decodeBody(c, &req) != nil || utf8.RuneCountInString(req.Topic) > 600 || socialSecretPattern.MatchString(req.Topic) || managedPrivatePattern.MatchString(req.Topic) {
		fail(c, 400, "MANAGED_TOPIC_INVALID", "讨论主题限 600 字，不能包含凭证或私人联系方式", nil)
		return
	}
	if !managedModelConfigured() || os.Getenv("AGENTNET_MANAGED_WORKER") != "true" {
		fail(c, 409, "MANAGED_NOT_READY", "平台模型或调度器尚未配置", nil)
		return
	}
	var blocked string
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817615)`).Error; err != nil {
			return err
		}
		var err error
		blocked, err = managedQueueBlock(tx, owner, id, time.Now())
		if err != nil || blocked != "" {
			return err
		}
		r := tx.Exec(`UPDATE managed_members SET next_run_at=?,pending_topic=? WHERE agent_id=? AND sponsor_uid=? AND enabled=true AND deleted_at=0`, time.Now().UnixMilli(), strings.TrimSpace(req.Topic), id, owner)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errConflict
		}
		return managedAudit(tx, owner, "queue_member", id)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	if blocked != "" {
		fail(c, 409, "MANAGED_ACTIVITY_BLOCKED", blocked, nil)
		return
	}
	reply(c, 200, map[string]any{"queued": true, "detail": "已排队，仍遵守活动时段、预算和每日上限"})
}
func (s *Service) pauseManaged(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`UPDATE managed_campaigns SET enabled=false,revision=revision+1 WHERE sponsor_uid=?`, owner).Error; err != nil {
			return err
		}
		return managedAudit(tx, owner, "pause_all", nil)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"paused": true})
}

func managedFailure(stage string) error { return fmt.Errorf("managed %s failed", stage) }

func (s *Service) batchManaged(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	var req struct {
		IDs     []string `json:"ids"`
		Enabled bool     `json:"enabled"`
	}
	if decodeBody(c, &req) != nil || len(req.IDs) < 1 || len(req.IDs) > 100 {
		fail(c, 400, "MANAGED_BATCH_INVALID", "请选择 1–100 个角色", nil)
		return
	}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, raw := range req.IDs {
		id := socialDecimal(raw)
		if id == 0 || seen[id] {
			fail(c, 400, "MANAGED_BATCH_INVALID", "角色编号无效或重复", nil)
			return
		}
		ids = append(ids, id)
		seen[id] = true
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Raw(`SELECT count(*) FROM managed_members WHERE agent_id IN ? AND sponsor_uid=? AND deleted_at=0`, ids, owner).Scan(&count).Error; err != nil {
			return err
		}
		if count != int64(len(ids)) {
			return errUnauthorized
		}
		if err := tx.Exec(`UPDATE managed_members SET enabled=?,revision=revision+1 WHERE agent_id IN ? AND sponsor_uid=?`, req.Enabled, ids, owner).Error; err != nil {
			return err
		}
		for _, id := range ids {
			action := "disable_member"
			if req.Enabled {
				action = "enable_member"
			}
			if err := managedAudit(tx, owner, action, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"updated": len(ids)})
}

func (s *Service) managedError(c *app.RequestContext, err error) {
	if errors.Is(err, errUnauthorized) {
		fail(c, 403, "MANAGED_FORBIDDEN", "这个账号不在你的运营范围内", nil)
	} else if errors.Is(err, errConflict) {
		fail(c, 409, "REVISION_CONFLICT", "资料或状态已更新，请刷新核对后重试", nil)
	} else if errors.Is(err, errInvalidOnboardingDraft) {
		fail(c, 400, "MANAGED_PROFILE_INVALID", "身份字段不符合长度或格式要求，请检查公开资料后重试", nil)
	} else {
		s.socialFailure(c, err)
	}
}
