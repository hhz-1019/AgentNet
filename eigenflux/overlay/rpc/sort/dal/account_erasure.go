package dal

import (
	"context"
	"errors"
	"sort"

	"eigenflux_server/pkg/db"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// Hold the same fence as account deletion through the external index write.
// A delayed queue task can never reindex a deleted account after cleanup.
func withAccountErasureFence(ctx context.Context, items []Item, write func() error) error {
	if len(items) == 0 {
		return nil
	}
	if db.DB == nil {
		return errors.New("database unavailable for index identity check")
	}
	ids := make([]int64, 0, len(items)*2)
	for _, item := range items {
		ids = append(ids, item.AuthorAgentID, item.ID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return db.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, id := range ids {
			if err := tx.Exec(`SELECT pg_advisory_xact_lock_shared(?)`, id).Error; err != nil {
				return err
			}
		}
		var erased bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM erased_agent_ids WHERE agent_id=ANY(?)) OR EXISTS(SELECT 1 FROM erased_item_ids WHERE item_id=ANY(?))`, pq.Array(ids), pq.Array(ids)).Scan(&erased).Error; err != nil {
			return err
		}
		if erased {
			return errors.New("account has been erased")
		}
		return write()
	})
}
