package consolev2

import (
	"context"
	"errors"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// ErasureMaintenanceReport contains identifiers and counts only, never credentials.
type ErasureMaintenanceReport struct {
	erasurePreview
	AgentIDs []string `json:"agent_ids"`
	Applied  bool     `json:"applied"`
}

// EraseAccountMaintenance is for the local service operator binary only. It has
// no HTTP route. A target is exactly one public account or one unowned Agent.
// It reuses the browser erasure transaction and blockers, never a broad reset.
func EraseAccountMaintenance(ctx context.Context, db *gorm.DB, accountNumber, unboundAgent int64, apply bool) (ErasureMaintenanceReport, error) {
	var result ErasureMaintenanceReport
	if (accountNumber > 0) == (unboundAgent > 0) {
		return result, errors.New("specify exactly one account or unbound Agent")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var account uidAccount
		var ids []int64
		if accountNumber > 0 {
			if e := tx.Raw("SELECT uid,account_number::text AS number,password_hash FROM human_accounts WHERE account_number=?", accountNumber).Scan(&account).Error; e != nil {
				return e
			}
			if account.UID == "" {
				return errors.New("account not found")
			}
			if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended('account-erasure:'||?,0))", account.UID).Error; e != nil {
				return e
			}
			if e := lockUID(tx, account); e != nil {
				return e
			}
			if e := tx.Raw("SELECT agent_id FROM agent_owners WHERE owner_uid=? ORDER BY agent_id", account.UID).Scan(&ids).Error; e != nil {
				return e
			}
			p, e := accountErasurePreview(tx, account.UID)
			if e != nil {
				return e
			}
			result.erasurePreview = p
		} else {
			if e := tx.Exec("SELECT pg_advisory_xact_lock(?)", unboundAgent).Error; e != nil {
				return e
			}
			// Lock before checking ownership so registration cannot race deletion.
			var id int64
			if e := tx.Raw("SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE", unboundAgent).Scan(&id).Error; e != nil {
				return e
			}
			if id == 0 {
				return errors.New("Agent not found")
			}
			var owned bool
			if e := tx.Raw("SELECT EXISTS(SELECT 1 FROM agent_owners WHERE agent_id=?)", id).Scan(&owned).Error; e != nil {
				return e
			}
			if owned {
				return errors.New("Agent belongs to an account; select that account instead")
			}
			ids = []int64{id}
			account.UID = "erasure-unbound:" + strconv.FormatInt(id, 10)
			result.Account = account.UID
			result.Agents = 1
		}
		result.AgentIDs = decimalIDs(ids)
		if e := checkErasureBlockers(tx, account, ids); e != nil {
			return e
		}
		if !apply {
			return nil
		}
		if e := eraseIdentityData(tx, account, ids); e != nil {
			return e
		}
		result.Applied = true
		return nil
	})
	return result, err
}
