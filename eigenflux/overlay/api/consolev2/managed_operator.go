package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ProvisionManagedOperator is only called by the server-side administration
// binary, never by a public HTTP route or at startup. Existing accounts cannot
// be replaced or have credentials reset through this operation.
func ProvisionManagedOperator(ctx context.Context, db *gorm.DB, gen IDGenerator, pepper string) (map[string]string, error) {
	if pepper == "" {
		return nil, errors.New("operator provisioning requires the configured OTP pepper")
	}
	password, err := randomToken("ops_", 24)
	if err != nil {
		return nil, err
	}
	recovery, err := randomToken("rk_", 32)
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	const uid = "managed_operator_v1"
	var number, id int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817611)`).Error; err != nil {
			return err
		}
		var exists bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM human_accounts WHERE uid=?)`, uid).Scan(&exists).Error; err != nil {
			return err
		}
		if exists {
			return errors.New("operator already exists; use saved credentials, no reset performed")
		}
		now := time.Now().UnixMilli()
		for _, candidate := range append([]int64{99999}, managedNumbers()...) {
			r := tx.Exec(`INSERT INTO owner_uid_numbers(number,source,owner_uid,created_at) VALUES(?,'operator',?,?) ON CONFLICT(number) DO NOTHING`, candidate, uid, now)
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected == 1 {
				number = candidate
				break
			}
		}
		if number == 0 {
			return errors.New("operator number pool exhausted")
		}
		if err := tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?)`, uid, number, string(hash), keyedHash(pepper, recovery), now).Error; err != nil {
			return err
		}
		var err error
		id, err = gen.NextID()
		if err != nil {
			return err
		}
		if err := insertProvisionedAgent(tx, id, uid+"@identity.invalid", "社区运营管理 · 官方", now); err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE agents SET is_official=true,profile_completed_at=? WHERE agent_id=?`, now, id).Error; err != nil {
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
		draft := managedPublicProfile("社区运营管理", "官方社区运营")
		draft.IdentityCard.AgentName = "社区运营管理 · 官方"
		draft.IdentityCard.AgentDescription = "elsewhere 官方社区运营 Agent，负责社区角色管理与运营支持。"
		for _, step := range []int16{2, 3, 5} {
			if err := applyConfirmedStep(tx, id, step, draft, map[string]fieldProvenance{}, now); err != nil {
				return err
			}
		}
		_, revision, err := compileAndActivateContext(tx, id, now)
		if err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,active_context_revision,created_at,updated_at,completed_at) VALUES(?,'completed',5,1,?,?,?,?)`, id, revision, now, now, now).Error; err != nil {
			return err
		}
		raw, err := json.Marshal(draft)
		if err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO agent_onboarding_drafts(agent_id,revision,draft_data,field_provenance,actor_type,request_id,created_at) VALUES(?,1,?::jsonb,'{}','human_edit',?,?)`, id, string(raw), "managed:"+uid, now).Error; err != nil {
			return err
		}
		if err := ensureTwinUser(tx, uid, now); err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE twin_users SET name='社区运营管理',current_goal=? WHERE user_id=?`, draft.NetworkGoal, uid).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE owner_uid_numbers SET reserved_agent_id=? WHERE number=?`, id, number).Error; err != nil {
			return err
		}
		return tx.Exec(`INSERT INTO owner_uid_admin_events(action,detail,actor,reason,created_at) VALUES('managed_operator_create',jsonb_build_object('number',?::bigint,'agent_id',?::bigint),'deployment-admin','Create dedicated community operator on owner request',?)`, number, id, now).Error
	})
	if err != nil {
		return nil, err
	}
	return map[string]string{"uid": strconv.FormatInt(number, 10), "agent_id": strconv.FormatInt(id, 10), "password": password, "recovery_key": recovery}, nil
}
