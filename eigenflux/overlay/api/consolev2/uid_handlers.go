package consolev2

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type uidRequest struct {
	AgreementVersion string `json:"agreement_version"`
	UID              string `json:"uid"`
	Password         string `json:"password"`
	AgentID          string `json:"agent_id"`
	RecoveryKey      string `json:"recovery_key"`
}
type uidAccount struct {
	UID          string
	PasswordHash string
	RecoveryHash string
}
type ownedAgent struct {
	AgentID   string `json:"agent_id"`
	AgentName string `json:"display_name"`
}

// UID is an identifier, never proof of ownership. Browser sessions and runtime
// signing keys remain separate. New phone credentials can bind to this same UID.
func validOwnerPassword(value string) bool { return len(value) >= 12 && len(value) <= 72 }

func (s *Service) uidRate(ctx context.Context, c *app.RequestContext, uid string) bool {
	if uid == "" {
		uid = "register:" + s.clientIPHash(c)
	}
	if s.redisClient == nil {
		fail(c, 503, "AUTH_UNAVAILABLE", "账号服务暂不可用，请稍后重试", nil)
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	keys := []string{"owner:uid:" + keyedHash(s.otpPepper, uid), "owner:ip:" + s.clientIPHash(c), "owner:global"}
	allowed, err := emailChallengeRateScript.Run(ctx, s.redisClient, keys,
		int64(10*time.Minute/time.Millisecond), 30, 150, 1500).Int()
	if err != nil {
		fail(c, 503, "AUTH_UNAVAILABLE", "账号服务暂不可用，请稍后重试", nil)
		return false
	}
	if allowed != 1 {
		fail(c, 429, "AUTH_RATE_LIMITED", "尝试过于频繁，请 10 分钟后重试", nil)
		return false
	}
	return true
}

func (s *Service) readUIDRequest(ctx context.Context, c *app.RequestContext) (uidRequest, bool) {
	var req uidRequest
	if err := decodeBody(c, &req); err != nil || len(req.UID) > 64 || len(req.Password) > 72 || len(req.RecoveryKey) > 128 {
		fail(c, 400, "INVALID_REQUEST", "请检查 UID 和密码格式", nil)
		return req, false
	}
	req.UID = strings.TrimSpace(req.UID)
	return req, s.uidRate(ctx, c, req.UID)
}

// Use a valid dummy bcrypt hash so unknown UIDs do not skip password work.
var dummyUIDHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-user-password"), bcrypt.DefaultCost)

func (s *Service) authenticateUID(req uidRequest) (uidAccount, error) {
	var account uidAccount
	if err := s.db.Raw(`SELECT uid, password_hash, recovery_hash FROM human_accounts WHERE uid = ?`, req.UID).Scan(&account).Error; err != nil {
		return account, err
	}
	hash := []byte(account.PasswordHash)
	if account.UID == "" {
		hash = dummyUIDHash
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(req.Password)) != nil || account.UID == "" {
		return account, errUnauthorized
	}
	return account, nil
}

func lockUID(tx *gorm.DB, account uidAccount) error {
	var hash string
	if err := tx.Raw(`SELECT password_hash FROM human_accounts WHERE uid = ? FOR UPDATE`, account.UID).Scan(&hash).Error; err != nil {
		return err
	}
	if hash == "" || hash != account.PasswordHash {
		return errUnauthorized
	}
	return nil
}

func uidFailure(c *app.RequestContext, err error) {
	switch {
	case errors.Is(err, errUnauthorized):
		fail(c, 401, "UID_AUTH_INVALID", "UID、密码或恢复密钥不正确", nil)
	case errors.Is(err, errConflict), isUniqueViolation(err):
		fail(c, 409, "OWNER_CONFLICT", "这个 Agent 已有所有者，或连接已经失效。请使用原账号登录", nil)
	case errors.Is(err, errConsoleAccountLimit):
		fail(c, 409, "ACCOUNT_LIMIT", "请先退出一个浏览器账号再继续", nil)
	default:
		fail(c, 500, "UID_AUTH_FAILED", "账号操作未完成，请稍后重试", nil)
	}
}

func claimUIDAgent(tx *gorm.DB, id int64, uid string, now int64) error {
	var state string
	if err := tx.Raw(`SELECT identity_state FROM agents WHERE agent_id = ? FOR UPDATE`, id).Scan(&state).Error; err != nil {
		return err
	}
	if state != "active" {
		return errConflict
	}
	var owner string
	if err := tx.Raw(`SELECT owner_uid FROM agent_owners WHERE agent_id = ?`, id).Scan(&owner).Error; err != nil {
		return err
	}
	if owner == uid {
		return nil
	}
	if owner != "" {
		return errConflict
	}
	// Existing email-owned identities need an explicit operator-assisted migration.
	// Possession of a runtime handoff must never overwrite their original owner.
	var legacy bool
	if err := tx.Raw(`SELECT EXISTS (SELECT 1 FROM agent_email_bindings WHERE agent_id = ? AND status = 'active')`, id).Scan(&legacy).Error; err != nil {
		return err
	}
	if legacy {
		return errConflict
	}
	return tx.Exec(`INSERT INTO agent_owners(agent_id, owner_uid, created_at) VALUES (?, ?, ?)`, id, uid, now).Error
}

type uidSession struct {
	ID, Secret, CSRF string
	Slot             int
}

func (s *Service) newUIDSession(tx *gorm.DB, c *app.RequestContext, uid string, id int64, now int64) (uidSession, error) {
	var result uidSession
	var err error
	result.ID, err = randomToken("efcs_", 18)
	if err != nil {
		return result, err
	}
	result.Secret, err = randomToken("", 32)
	if err != nil {
		return result, err
	}
	result.CSRF, err = randomToken("efcsrf_", 24)
	if err != nil {
		return result, err
	}
	replaced := ""
	result.Slot, replaced, _, err = s.chooseConsoleSessionSlot(tx, c, id, 0, now)
	if errors.Is(err, errConsoleAccountLimit) {
		source, _ := agentID(c)
		if source > 0 {
			result.Slot, replaced, _, err = s.chooseConsoleSessionSlot(tx, c, id, source, now)
		}
	}
	if err != nil {
		return result, err
	}
	key := make([]byte, 32)
	if _, err = rand.Read(key); err != nil {
		return result, err
	}
	var principal int64
	if err = tx.Raw(`INSERT INTO agent_principals (agent_id,key_type,key_fingerprint,public_key,status,created_at,last_seen_at)
        VALUES (?, 'uid-browser-v1', ?, ?, 'limited', ?, ?) RETURNING principal_id`, id,
		fingerprintForKeyType("uid-browser-v1", key), key, now, now).Scan(&principal).Error; err != nil {
		return result, err
	}
	if replaced != "" {
		if err = tx.Exec(`UPDATE console_v2_sessions SET status='revoked', revoked_at=? WHERE session_id=?`, now, replaced).Error; err != nil {
			return result, err
		}
	}
	err = tx.Exec(`INSERT INTO console_v2_sessions
        (session_id,session_secret_hash,agent_id,principal_id,csrf_secret_hash,status,scopes,issued_at,idle_expires_at,absolute_expires_at,last_seen_at,auth_method,recent_auth_at,owner_uid)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 'uid_password', ?, ?)`, result.ID, hashString(result.Secret), id, principal, hashString(result.CSRF),
		pq.Array([]string{"console:onboarding", "console:read", "console:write"}), now,
		now+int64(consoleIdleTTL/time.Millisecond), now+int64(consoleAbsoluteTTL/time.Millisecond), now, now, uid).Error
	return result, err
}

func (s *Service) issueUIDSession(c *app.RequestContext, session uidSession) {
	c.Header("Cache-Control", "no-store")
	age := int(consoleAbsoluteTTL / time.Second)
	s.setConsoleCookieAtSlot(c, session.Slot, session.ID+"."+session.Secret, age)
	s.setCSRFCookieAtSlot(c, session.Slot, session.CSRF, age)
	s.setActiveConsoleSlot(c, session.Slot, age)
}

func (s *Service) registerUID(ctx context.Context, c *app.RequestContext) {
	req, ok := s.readUIDRequest(ctx, c)
	if !ok {
		return
	}
	if req.AgreementVersion != twinAgreementVersion {
		fail(c, 400, "AGREEMENT_REQUIRED", "请阅读并勾选用户协议后注册", nil)
		return
	}
	if !validOwnerPassword(req.Password) {
		fail(c, 400, "PASSWORD_INVALID", "密码需要 12–72 字节，建议使用至少 12 位英文、数字或符号", nil)
		return
	}
	uid, err := randomToken("u_", 12)
	if err != nil {
		uidFailure(c, err)
		return
	}
	recovery, err := randomToken("rk_", 32)
	if err != nil {
		uidFailure(c, err)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		uidFailure(c, err)
		return
	}
	id, _ := agentID(c)
	now := time.Now().UnixMilli()
	var session uidSession
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO human_accounts(uid,password_hash,recovery_hash,created_at) VALUES (?, ?, ?, ?)`, uid, string(hash), keyedHash(s.otpPepper, recovery), now).Error; err != nil {
			return err
		}
		if err := claimUIDAgent(tx, id, uid, now); err != nil {
			return err
		}
		if err := ensureTwinUser(tx, uid, now); err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO twin_agreement_acceptances(user_id,version,accepted_at) VALUES(?,?,?)`, uid, twinAgreementVersion, now).Error; err != nil {
			return err
		}
		var err error
		session, err = s.newUIDSession(tx, c, uid, id, now)
		return err
	})
	if err != nil {
		uidFailure(c, err)
		return
	}
	s.issueUIDSession(c, session)
	reply(c, http.StatusCreated, map[string]interface{}{"uid": uid, "recovery_key": recovery, "agent_id": fmt.Sprint(id)})
}

// Credential validation and Agent selection are separate: only a verified owner
// receives the list, and every final operation verifies the password again.
func (s *Service) loginUID(ctx context.Context, c *app.RequestContext) {
	req, ok := s.readUIDRequest(ctx, c)
	if !ok {
		return
	}
	account, err := s.authenticateUID(req)
	if err != nil {
		uidFailure(c, err)
		return
	}
	var agents []ownedAgent
	if err := s.db.Raw(`SELECT a.agent_id::text AS agent_id, a.agent_name FROM agent_owners o JOIN agents a ON a.agent_id=o.agent_id
        WHERE o.owner_uid=? AND a.identity_state='active' ORDER BY o.created_at,a.agent_id`, account.UID).Scan(&agents).Error; err != nil {
		uidFailure(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	if req.AgentID == "" {
		reply(c, 200, map[string]interface{}{"uid": account.UID, "agents": agents})
		return
	}
	id, err := strconv.ParseInt(req.AgentID, 10, 64)
	if err != nil || id <= 0 {
		fail(c, 400, "INVALID_AGENT", "请选择一个 Agent", nil)
		return
	}
	now := time.Now().UnixMilli()
	var session uidSession
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUID(tx, account); err != nil {
			return err
		}
		var owns bool
		if err := tx.Raw(`SELECT EXISTS (SELECT 1 FROM agent_owners o JOIN agents a ON a.agent_id=o.agent_id
            WHERE o.owner_uid=? AND o.agent_id=? AND a.identity_state='active')`, account.UID, id).Scan(&owns).Error; err != nil {
			return err
		}
		if !owns {
			return errUnauthorized
		}
		var err error
		session, err = s.newUIDSession(tx, c, account.UID, id, now)
		return err
	})
	if err != nil {
		uidFailure(c, err)
		return
	}
	s.issueUIDSession(c, session)
	reply(c, 200, map[string]interface{}{"uid": account.UID, "agent_id": req.AgentID})
}

func (s *Service) claimUID(ctx context.Context, c *app.RequestContext) {
	req, ok := s.readUIDRequest(ctx, c)
	if !ok {
		return
	}
	account, err := s.authenticateUID(req)
	if err != nil {
		uidFailure(c, err)
		return
	}
	source, _ := agentID(c)
	id := source
	if req.AgentID != "" {
		id, err = strconv.ParseInt(req.AgentID, 10, 64)
	}
	if err != nil || id <= 0 {
		fail(c, 400, "INVALID_AGENT", "请选择一个 Agent", nil)
		return
	}
	now := time.Now().UnixMilli()
	var session uidSession
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUID(tx, account); err != nil {
			return err
		}
		var record cliAccountSwitchRecord
		switching := strings.HasSuffix(string(c.Path()), "/switch")
		if switching {
			var err error
			record, err = s.pendingEmailSwitch(tx, c, now)
			if err != nil {
				return err
			}
			source = record.SourceAgentID
			if req.AgentID == "" {
				return errConflict
			}
		}
		if id == source {
			if err := claimUIDAgent(tx, id, account.UID, now); err != nil {
				return err
			}
		} else {
			var owns bool
			if err := tx.Raw(`SELECT EXISTS (SELECT 1 FROM agent_owners WHERE agent_id=? AND owner_uid=?)`, id, account.UID).Scan(&owns).Error; err != nil {
				return err
			}
			if !owns {
				return errUnauthorized
			}
		}
		if id != source && !switching {
			principal, _ := c.Get("principal_id")
			principalID, ok := principal.(int64)
			if !ok {
				return errUnauthorized
			}
			sourceSession, _ := c.Get("console_session_id")
			sourceSessionID, ok := sourceSession.(string)
			if !ok {
				return errUnauthorized
			}
			token, err := randomToken("efas_", 32)
			if err != nil {
				return err
			}
			record = cliAccountSwitchRecord{SwitchIDHash: hashString(token), SourceAgentID: source, PrincipalID: principalID, SourceConsoleSession: sourceSessionID, Status: "pending_target"}
			if err := validateNoopPrincipalBinding(tx, record); err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO agent_cli_account_switches
                (switch_id_hash,source_agent_id,principal_id,source_console_session_id,status,expires_at,created_at)
                VALUES (?, ?, ?, ?, 'pending_target', ?, ?)`, record.SwitchIDHash, source, principalID, sourceSessionID, now+int64(cliAccountSwitchTTL/time.Millisecond), now).Error; err != nil {
				return err
			}
		}
		var suspended bool
		if err := tx.Raw(`SELECT EXISTS (SELECT 1 FROM agent_principals WHERE agent_id=? AND status='suspended')`, id).Scan(&suspended).Error; err != nil {
			return err
		}
		if suspended {
			return errConflict
		}
		var err error
		session, err = s.newUIDSession(tx, c, account.UID, id, now)
		if err != nil {
			return err
		}
		if id != source {
			record.TargetAgentID, record.TargetConsoleSession, record.OwnershipVerifiedAt = &id, session.ID, &now
			// Reuse upstream's atomic principal move, refresh fence and audit.
			if err := finalizeCLIAccountSwitch(tx, record, now, true); err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE console_v2_sessions SET status='revoked', revoked_at=? WHERE principal_id=? AND session_id<>? AND status='active'`, now, record.PrincipalID, session.ID).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE console_v2_handoffs SET revoked_at=? WHERE principal_id=? AND revoked_at IS NULL AND consumed_at IS NULL`, now, record.PrincipalID).Error; err != nil {
				return err
			}
		} else if switching {
			if err := completeNoopCLIAccountSwitch(tx, record, now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		uidFailure(c, err)
		return
	}
	s.issueUIDSession(c, session)
	reply(c, 200, map[string]interface{}{"uid": account.UID, "agent_id": fmt.Sprint(id), "refresh_required": id != source})
}

func (s *Service) resetUIDPassword(ctx context.Context, c *app.RequestContext) {
	req, ok := s.readUIDRequest(ctx, c)
	if !ok {
		return
	}
	if !validOwnerPassword(req.Password) {
		fail(c, 400, "PASSWORD_INVALID", "新密码需要 12–72 字节", nil)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		uidFailure(c, err)
		return
	}
	recovery, err := randomToken("rk_", 32)
	if err != nil {
		uidFailure(c, err)
		return
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var stored string
		if err := tx.Raw(`SELECT recovery_hash FROM human_accounts WHERE uid=? FOR UPDATE`, req.UID).Scan(&stored).Error; err != nil {
			return err
		}
		if stored == "" || subtle.ConstantTimeCompare([]byte(stored), []byte(keyedHash(s.otpPepper, req.RecoveryKey))) != 1 {
			return errUnauthorized
		}
		if err := tx.Exec(`UPDATE human_accounts SET password_hash=?, recovery_hash=? WHERE uid=?`, string(hash), keyedHash(s.otpPepper, recovery), req.UID).Error; err != nil {
			return err
		}
		return tx.Exec(`UPDATE console_v2_sessions SET status='revoked',revoked_at=? WHERE agent_id IN (SELECT agent_id FROM agent_owners WHERE owner_uid=?) AND status='active'`, time.Now().UnixMilli(), req.UID).Error
	})
	if err != nil {
		uidFailure(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	reply(c, 200, map[string]interface{}{"uid": req.UID, "recovery_key": recovery})
}
