package consolev2

import (
	"context"
	"errors"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
	"strconv"
	"strings"
	"unicode/utf8"
)

var errSocialOrganization = errors.New("organization membership does not allow this attribution")

type socialOrganizationRow struct {
	OrganizationID int64
	OwnerAgentID   int64
	OwnerName      string
	Name           string
	Revision       int64
	Role           string
	Status         string
}

func socialDecimal(value string) int64 {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != value {
		return 0
	}
	return id
}

// Lock the organization for both membership changes and publication. Revocation
// cannot race a first publication. Published snapshots keep historical attribution.
func (s *Service) authorizeSocialOrganization(ctx context.Context, viewer int64, d socialDocument) error {
	if d.OrganizationID == "" {
		return nil
	}
	var row socialOrganizationRow
	if err := s.db.WithContext(ctx).Raw(`SELECT * FROM social_organizations WHERE organization_id=? FOR UPDATE`, socialDecimal(d.OrganizationID)).Scan(&row).Error; err != nil {
		return err
	}
	var n int64
	if err := s.db.WithContext(ctx).Raw(`SELECT count(*) FROM social_organization_members WHERE organization_id=? AND agent_id=? AND status='active' AND role IN ('owner','editor')`, row.OrganizationID, viewer).Scan(&n).Error; err != nil {
		return err
	}
	if row.OrganizationID == 0 || n != 1 || row.Name != d.ProjectName {
		return errSocialOrganization
	}
	return nil
}
func (s *Service) getSocialOrganizations(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var rows []socialOrganizationRow
	if err := s.db.WithContext(ctx).Raw(`SELECT o.*,m.role,m.status,oa.agent_name AS owner_name FROM social_organizations o JOIN social_organization_members m USING(organization_id) JOIN agents oa ON oa.agent_id=o.owner_agent_id WHERE m.agent_id=? AND m.status IN ('active','pending') ORDER BY o.organization_id`, viewer).Scan(&rows).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	items := []map[string]any{}
	for _, r := range rows {
		members := []map[string]any{}
		if r.Status == "active" {
			var ms []struct {
				AgentID   int64
				AgentName string
				Role      string
				Status    string
			}
			if err := s.db.WithContext(ctx).Raw(`SELECT m.*,a.agent_name FROM social_organization_members m JOIN agents a USING(agent_id) WHERE organization_id=? AND status<>'revoked' ORDER BY agent_id`, r.OrganizationID).Scan(&ms).Error; err != nil {
				s.socialFailure(c, err)
				return
			}
			for _, m := range ms {
				members = append(members, map[string]any{"agent_id": strconv.FormatInt(m.AgentID, 10), "name": m.AgentName, "role": m.Role, "status": m.Status})
			}
		}
		items = append(items, map[string]any{"id": strconv.FormatInt(r.OrganizationID, 10), "name": r.Name, "owner_id": strconv.FormatInt(r.OwnerAgentID, 10), "owner_name": r.OwnerName, "revision": r.Revision, "role": r.Role, "status": r.Status, "members": members})
	}
	reply(c, 200, map[string]any{"items": items})
}
func (s *Service) createSocialOrganization(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req struct {
		Name string `json:"name"`
		Key  string `json:"idempotency_key"`
	}
	if decodeBody(c, &req) != nil || utf8.RuneCountInString(strings.TrimSpace(req.Name)) < 2 || utf8.RuneCountInString(req.Name) > 80 || len(req.Key) < 1 || len(req.Key) > 128 {
		fail(c, 400, "INVALID_REQUEST", "团队名称需为 2–80 字，并提供操作键", nil)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	id, err := s.idgen.NextID()
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, viewer).Error; err != nil {
			return err
		}
		var prior socialOrganizationRow
		if err := tx.Raw(`SELECT * FROM social_organizations WHERE owner_agent_id=? AND creation_key=?`, viewer, req.Key).Scan(&prior).Error; err != nil {
			return err
		}
		if prior.OrganizationID != 0 {
			if prior.Name != req.Name {
				return errConflict
			}
			return nil
		}
		if err := tx.Exec(`INSERT INTO social_organizations(organization_id,owner_agent_id,name,creation_key) VALUES(?,?,?,?)`, id, viewer, req.Name, req.Key).Error; err != nil {
			return err
		}
		return tx.Exec(`INSERT INTO social_organization_members VALUES(?,?,'owner','active')`, id, viewer).Error
	})
	if err != nil {
		s.socialOrganizationFailure(c, err)
		return
	}
	s.getSocialOrganizations(ctx, c)
}
func (s *Service) socialOrganizationFailure(c *app.RequestContext, err error) {
	if errors.Is(err, errConflict) {
		fail(c, 409, "REVISION_CONFLICT", "成员权限已变化，请刷新后核对", nil)
		return
	}
	s.socialFailure(c, err)
}
func (s *Service) setSocialOrganizationMember(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialDecimal(c.Param("organization_id"))
	target := socialDecimal(c.Param("member_id"))
	var req struct {
		Role             string `json:"role"`
		Action           string `json:"action"`
		ExpectedRevision int64  `json:"expected_revision"`
	}
	if decodeBody(c, &req) != nil || id == 0 || target == 0 || (req.Action != "invite" && req.Action != "revoke") || (req.Role != "editor" && req.Role != "viewer") {
		fail(c, 400, "INVALID_REQUEST", "请选择有效成员、角色与操作", nil)
		return
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row socialOrganizationRow
		if err := tx.Raw(`SELECT * FROM social_organizations WHERE organization_id=? FOR UPDATE`, id).Scan(&row).Error; err != nil {
			return err
		}
		if row.OrganizationID == 0 || row.OwnerAgentID != viewer || target == row.OwnerAgentID {
			return errSocialOrganization
		}
		if row.Revision != req.ExpectedRevision {
			return errConflict
		}
		var exists int64
		if err := tx.Raw(`SELECT count(*) FROM agents WHERE agent_id=?`, target).Scan(&exists).Error; err != nil {
			return err
		}
		if exists != 1 {
			return gorm.ErrRecordNotFound
		}
		if req.Action == "invite" {
			// Active members consent again when their role changes; same-role invites are harmless.
			if err := tx.Exec(`INSERT INTO social_organization_members VALUES(?,?,?,'pending') ON CONFLICT(organization_id,agent_id) DO UPDATE SET role=excluded.role,status=CASE WHEN social_organization_members.status='active' AND social_organization_members.role=excluded.role THEN 'active' ELSE 'pending' END`, id, target, req.Role).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Exec(`UPDATE social_organization_members SET status='revoked' WHERE organization_id=? AND agent_id=?`, id, target).Error; err != nil {
				return err
			}
		}
		return tx.Exec(`UPDATE social_organizations SET revision=revision+1 WHERE organization_id=?`, id).Error
	})
	if err != nil {
		s.socialOrganizationFailure(c, err)
		return
	}
	s.getSocialOrganizations(ctx, c)
}
func (s *Service) joinSocialOrganization(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id := socialDecimal(c.Param("organization_id"))
	var req struct {
		Approved         *bool `json:"approved"`
		ExpectedRevision int64 `json:"expected_revision"`
	}
	if decodeBody(c, &req) != nil || id == 0 || req.Approved == nil {
		fail(c, 400, "INVALID_REQUEST", "请明确接受或拒绝邀请", nil)
		return
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row socialOrganizationRow
		if err := tx.Raw(`SELECT * FROM social_organizations WHERE organization_id=? FOR UPDATE`, id).Scan(&row).Error; err != nil {
			return err
		}
		if row.OrganizationID == 0 {
			return gorm.ErrRecordNotFound
		}
		if row.Revision != req.ExpectedRevision {
			return errConflict
		}
		status := "revoked"
		if *req.Approved {
			status = "active"
		}
		result := tx.Exec(`UPDATE social_organization_members SET status=? WHERE organization_id=? AND agent_id=? AND status='pending'`, status, id, viewer)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errSocialOrganization
		}
		return tx.Exec(`UPDATE social_organizations SET revision=revision+1 WHERE organization_id=?`, id).Error
	})
	if err != nil {
		s.socialOrganizationFailure(c, err)
		return
	}
	s.getSocialOrganizations(ctx, c)
}
