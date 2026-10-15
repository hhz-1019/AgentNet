package consolev2

import (
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Detach an operator-reviewed mismatch. Keep the media bytes and usage claim for
// rollback and deduplication; require the exact revision reviewed by the operator.
func (s *Service) removeManagedPostPhoto(ctx context.Context, owner string, id, revision int64) (int, error) {
	updated := 0
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row struct {
			AgentID, Revision int64
			Document          string
		}
		if err := tx.Raw(`SELECT p.agent_id,p.revision,p.document::text AS document FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE p.post_id=? AND m.sponsor_uid=? AND m.deleted_at=0 AND p.state='published' AND p.visibility='public' FOR UPDATE OF p`, id, owner).Scan(&row).Error; err != nil {
			return err
		}
		if row.AgentID == 0 || revision <= 0 || row.Revision != revision {
			return errConflict
		}
		var d socialDocument
		if err := json.Unmarshal([]byte(row.Document), &d); err != nil {
			return err
		}
		if len(d.Media) == 0 {
			return nil
		}
		d.Media = []socialMedia{}
		raw, err := json.Marshal(d)
		if err != nil {
			return err
		}
		if err = tx.Exec(`UPDATE social_work_posts SET document=?::jsonb,revision=revision+1,approved_revision=revision+1 WHERE post_id=?`, string(raw), id).Error; err != nil {
			return err
		}
		if err = managedAudit(tx, owner, "detach_photo", row.AgentID); err != nil {
			return err
		}
		updated = 1
		return nil
	})
	return updated, err
}

// Operator-selected subjects repair the existing feed without rewriting prose.
func (s *Service) backfillManagedPostPhoto(ctx context.Context, c *app.RequestContext, owner, postID, query string) {
	id := socialDecimal(postID)
	if id == 0 || !managedPhotoQuery.MatchString(query) {
		fail(c, 400, "INVALID_REQUEST", "请提供帖子和相关摄影检索词", nil)
		return
	}
	var row struct {
		AgentID, Revision  int64
		Document, Scenario string
	}
	err := s.db.WithContext(ctx).Raw(`SELECT p.agent_id,p.revision,p.document::text AS document,m.scenario FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE p.post_id=? AND m.sponsor_uid=? AND m.deleted_at=0 AND p.state='published' AND p.visibility='public'`, id, owner).Scan(&row).Error
	if err != nil {
		s.managedError(c, err)
		return
	}
	if row.AgentID == 0 {
		fail(c, 404, "NOT_FOUND", "帖子不存在", nil)
		return
	}
	var d socialDocument
	if err = json.Unmarshal([]byte(row.Document), &d); err != nil {
		s.managedError(c, err)
		return
	}
	if len(d.Media) > 0 {
		reply(c, 200, map[string]any{"updated": 0})
		return
	}
	var used []string
	if err = s.db.WithContext(ctx).Raw("SELECT source_page FROM managed_photo_usage").Scan(&used).Error; err != nil {
		s.managedError(c, err)
		return
	}
	excluded := make(map[string]bool, len(used))
	for _, page := range used {
		excluded[page] = true
	}
	photo, err := selectManagedPhoto(ctx, d, row.Scenario, query, id, excluded)
	if err != nil {
		s.managedError(c, err)
		return
	}
	updated := 0
	if len(photo.Content) > 0 {
		err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var current int64
			if err := tx.Raw(`SELECT p.revision FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE p.post_id=? AND m.sponsor_uid=? AND m.deleted_at=0 AND p.state='published' AND p.visibility='public' FOR UPDATE OF p`, id, owner).Scan(&current).Error; err != nil {
				return err
			}
			if current != row.Revision {
				return errConflict
			}
			if err := s.addManagedPhoto(tx, row.AgentID, &d, photo); err != nil {
				return err
			}
			if len(d.Media) == 0 {
				return nil
			}
			raw, _ := json.Marshal(d)
			if err := tx.Exec(`UPDATE social_work_posts SET document=?::jsonb,revision=revision+1,approved_revision=revision+1 WHERE post_id=?`, string(raw), id).Error; err != nil {
				return err
			}
			updated = 1
			return managedAudit(tx, owner, "collect_photo", row.AgentID)
		})
	}
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"updated": updated})
}
