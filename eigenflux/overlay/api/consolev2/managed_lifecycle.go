package consolev2

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"eigenflux_server/pkg/agentcard"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

func (s *Service) createManagedMember(ctx context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	var req struct {
		Name     string `json:"name"`
		Scenario string `json:"scenario"`
		Persona  string `json:"persona"`
	}
	if decodeBody(c, &req) != nil || strings.TrimSpace(req.Name) == "" || utf8.RuneCountInString(req.Name) > 30 || managedSceneIndex(req.Scenario) < 0 || utf8.RuneCountInString(req.Persona) < 1001 || utf8.RuneCountInString(req.Persona) > 6000 || socialSecretPattern.MatchString(req.Name+req.Persona) || managedPrivatePattern.MatchString(req.Persona) {
		fail(c, 400, "MANAGED_MEMBER_INVALID", "填写昵称、支持的场景与 1001–6000 字身份档案", nil)
		return
	}
	ids, err := s.provisionManagedEntries(ctx, owner, map[int]managedPersona{-1: {Name: strings.TrimSpace(req.Name), Scenario: req.Scenario, Persona: req.Persona}})
	if err != nil {
		s.managedError(c, err)
		return
	}
	for _, id := range ids {
		agentcard.PublishRebuild(ctx, id, "managed_create")
		publishProfileCompletion(ctx, id)
	}
	reply(c, 201, map[string]any{"created": len(ids), "agent_id": fmtRun(ids[0])})
}

// Explicit operator action; repeat calls do not overwrite later manual edits.
func (s *Service) refreshManagedProfiles(ctx context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	ids := []int64{}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817615)`).Error; err != nil {
			return err
		}
		var members []struct {
			AgentID   int64
			SeedIndex int
			Name      string
		}
		if err := tx.Raw(`SELECT agent_id,seed_index,name FROM managed_members WHERE sponsor_uid=? AND deleted_at=0 AND seed_index<100 AND profile_version<2 ORDER BY seed_index FOR UPDATE`, owner).Scan(&members).Error; err != nil {
			return err
		}
		for _, m := range members {
			p := managedRichPersona(m.SeedIndex, m.Name)
			now := time.Now().UnixMilli()
			if err := tx.Exec(`UPDATE managed_members SET scenario=?,persona=?,profile_version=2,pending_topic='',revision=revision+1 WHERE agent_id=?`, p.Scenario, p.Persona, m.AgentID).Error; err != nil {
				return err
			}
			draft := managedRichDraft(p, m.SeedIndex)
			for _, step := range []int16{2, 3} {
				if err := applyConfirmedStep(tx, m.AgentID, step, draft, map[string]fieldProvenance{}, now); err != nil {
					return err
				}
			}
			_, revision, err := compileAndActivateContext(tx, m.AgentID, now)
			if err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE agent_onboarding_v2 SET active_context_revision=?,updated_at=? WHERE agent_id=?`, revision, now, m.AgentID).Error; err != nil {
				return err
			}
			if err := saveManagedIdentityDraft(tx, m.AgentID, draft, now); err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE twin_users SET current_goal=? WHERE user_id=(SELECT owner_uid FROM managed_members WHERE agent_id=?)`, draft.NetworkGoal, m.AgentID).Error; err != nil {
				return err
			}
			ids = append(ids, m.AgentID)
		}
		return managedAudit(tx, owner, "refresh_profiles", nil)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	for _, id := range ids {
		agentcard.PublishRebuild(ctx, id, "managed_profile_refresh")
	}
	reply(c, 200, map[string]any{"updated": len(ids)})
}

// Keep the completed onboarding editor in sync with the public identity/context.
func saveManagedIdentityDraft(tx *gorm.DB, id int64, draft draftPayload, now int64) error {
	var revision int64
	if err := tx.Raw(`UPDATE agent_onboarding_v2 SET revision=revision+1,updated_at=? WHERE agent_id=? RETURNING revision`, now, id).Scan(&revision).Error; err != nil {
		return err
	}
	identity, _ := json.Marshal(draft.IdentityCard)
	goal, _ := json.Marshal(draft.NetworkGoal)
	return tx.Exec(`INSERT INTO agent_onboarding_drafts(agent_id,revision,draft_data,field_provenance,actor_type,request_id,created_at)
 SELECT agent_id,?,jsonb_set(jsonb_set(draft_data,'{identity_card}',?::jsonb),'{network_goal}',?::jsonb),field_provenance,'human_edit',?,? FROM agent_onboarding_drafts WHERE agent_id=? ORDER BY revision DESC LIMIT 1`, revision, string(identity), string(goal), "managed-edit:"+fmtRun(id)+":"+fmtRun(revision), now, id).Error
}

func (s *Service) deleteManagedMember(ctx context.Context, c *app.RequestContext) {
	s.changeManagedArchive(ctx, c, true)
}
func (s *Service) restoreManagedMember(ctx context.Context, c *app.RequestContext) {
	s.changeManagedArchive(ctx, c, false)
}
func (s *Service) changeManagedArchive(ctx context.Context, c *app.RequestContext, remove bool) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	id := socialDecimal(c.Param("member_id"))
	var req struct {
		Revision int64 `json:"revision"`
	}
	if decodeBody(c, &req) != nil || req.Revision < 1 {
		fail(c, 400, "MANAGED_MEMBER_INVALID", "请刷新角色资料后重试", nil)
		return
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817615)`).Error; err != nil {
			return err
		}
		// Match commitManaged lock order, preventing publish-after-delete races.
		if err := tx.Exec(`SELECT sponsor_uid FROM managed_campaigns WHERE sponsor_uid=? FOR UPDATE`, owner).Error; err != nil {
			return err
		}
		deleted := int64(0)
		state := "active"
		action := "restore_member"
		if remove {
			if err := tx.Exec(`UPDATE agent_credential_sessions sessions SET revoked_at=COALESCE(sessions.revoked_at,?) FROM agent_principals principals WHERE sessions.principal_id=principals.principal_id AND principals.agent_id=?`, time.Now().UnixMilli(), id).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE agent_principals SET status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE agent_id=?`, time.Now().UnixMilli(), id).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE console_v2_handoffs SET revoked_at=COALESCE(revoked_at,?) WHERE agent_id=? AND consumed_at IS NULL`, time.Now().UnixMilli(), id).Error; err != nil {
				return err
			}
			deleted = time.Now().UnixMilli()
			state = "managed_archived"
			action = "delete_member"
		}
		r := tx.Exec(`UPDATE managed_members SET enabled=false,deleted_at=?,pending_topic='',revision=revision+1 WHERE agent_id=? AND sponsor_uid=? AND revision=? AND (deleted_at>0)=?`, deleted, id, owner, req.Revision, !remove)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errConflict
		}
		if err := tx.Exec(`UPDATE agents SET identity_state=?,updated_at=? WHERE agent_id=?`, state, time.Now().UnixMilli(), id).Error; err != nil {
			return err
		}
		if remove {
			if err := tx.Exec(`UPDATE console_v2_sessions SET status='revoked',revoked_at=? WHERE agent_id=? AND status='active'`, time.Now().UnixMilli(), id).Error; err != nil {
				return err
			}
		}
		return managedAudit(tx, owner, action, id)
	})
	if err != nil {
		s.managedError(c, err)
		return
	}
	agentcard.PublishRebuild(ctx, id, "managed_lifecycle")
	reply(c, 200, map[string]any{"deleted": remove, "restored": !remove})
}
