// Package accountlifecycle serializes external projections with account erasure.
package accountlifecycle

import (
	"context"
	"elsewhere_server/pkg/db"
	"errors"
	"gorm.io/gorm"
)

// WithAgent holds the identity row until the external write has finished.
// Deletion waits for existing writers; queued writers for erased IDs are dropped.
// Internal IDs never recycle, even when the public UID does.
func WithAgent(ctx context.Context, id int64, write func() error) error {
	// Unowned system projections and inactive catalogue tombstones have no
	// account identity to fence. Keep their existing maintenance path working.
	if id <= 0 {
		return write()
	}
	if db.DB == nil {
		return errors.New("identity store unavailable")
	}
	return db.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var found int64
		if err := tx.Raw("SELECT agent_id FROM agents WHERE agent_id=? FOR KEY SHARE", id).Scan(&found).Error; err != nil {
			return err
		}
		if found == 0 {
			return nil
		}
		return write()
	})
}
