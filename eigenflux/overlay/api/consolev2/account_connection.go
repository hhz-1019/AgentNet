package consolev2

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

const accountConnectionPrefix = "efcn_"

// This reference selects an unregistered runtime, never authenticates a person.
// Once a phone-backed account exists it can only lead to normal account login.
// The runtime key and owner/password checks remain separate.
func (s *Service) createAccountConnection(ctx context.Context, c *app.RequestContext, id, principal int64, capabilities []string) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	var account string
	if err := s.db.WithContext(ctx).Raw(`SELECT a.account_number::text FROM agent_owners o JOIN human_accounts a ON a.uid=o.owner_uid WHERE o.agent_id=?`, id).Scan(&account).Error; err != nil {
		fail(c, 500, "CONNECTION_FAILED", "注册页面暂时无法打开，请重试", nil)
		return
	}
	if account != "" {
		reply(c, 200, map[string]any{"handoff_url": s.publicURL + "/dashboard?account=" + url.QueryEscape(account), "account": account, "registered": true})
		return
	}
	// Stable per signing principal, isolated from phone hashes and other tokens.
	key := accountConnectionPrefix + keyedHash(s.otpPepper, fmt.Sprintf("account-connect-v1:%d:%d", id, principal))
	now := time.Now().UnixMilli()
	const noExpiry int64 = 253402300799000
	err := s.db.WithContext(ctx).Exec(`INSERT INTO console_v2_handoffs
	(ticket_hash,agent_id,principal_id,console_scope,browser_nonce_hash,client_capabilities,expires_at,created_at)
	VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ticket_hash) DO UPDATE SET client_capabilities=EXCLUDED.client_capabilities
	WHERE console_v2_handoffs.revoked_at IS NULL`, hashString(key), id, principal,
		pq.Array([]string{"console:onboarding", "console:read", "console:write"}), hashString(""), pq.Array(capabilities), noExpiry, now).Error
	if err != nil {
		fail(c, 500, "CONNECTION_FAILED", "注册页面暂时无法打开，请重试", nil)
		return
	}
	reply(c, 200, map[string]any{"handoff_url": s.publicURL + "/dashboard/register#connect=" + url.QueryEscape(key), "registered": false})
}

func (s *Service) exchangeAccountConnection(ctx context.Context, c *app.RequestContext, req exchangeRequest) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if len(req.Ticket) != len(accountConnectionPrefix)+64 {
		fail(c, 400, "CONNECTION_INVALID", "无法打开注册页面，请从原 Agent 重新打开", nil)
		return
	}
	now := time.Now().UnixMilli()
	var id, principal int64
	var account string
	var slot int
	var reused bool
	var sessionID, sessionSecret, csrf string
	var accountLimit []consoleAccountView
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var connection struct {
			AgentID            int64
			PrincipalID        int64
			PrincipalAgentID   int64
			PrincipalStatus    string
			PrincipalRevokedAt *int64
			IdentityState      string
			Capabilities       pq.StringArray `gorm:"column:client_capabilities;type:text[]"`
		}
		if err := tx.Raw(`SELECT h.agent_id,h.principal_id,p.agent_id AS principal_agent_id,p.status AS principal_status,p.revoked_at AS principal_revoked_at,a.identity_state,h.client_capabilities
		 FROM console_v2_handoffs h JOIN agent_principals p USING(principal_id) JOIN agents a ON a.agent_id=h.agent_id
		 WHERE h.ticket_hash=? AND h.revoked_at IS NULL FOR UPDATE OF h,a`, hashString(req.Ticket)).Scan(&connection).Error; err != nil {
			return err
		}
		if !validActiveIdentityBinding(connection.AgentID, connection.PrincipalAgentID, connection.IdentityState, connection.PrincipalStatus, connection.PrincipalRevokedAt) {
			return errUnauthorized
		}
		id, principal = connection.AgentID, connection.PrincipalID
		if err := tx.Raw(`SELECT a.account_number::text FROM agent_owners o JOIN human_accounts a ON a.uid=o.owner_uid WHERE o.agent_id=?`, id).Scan(&account).Error; err != nil {
			return err
		}
		for i := 0; i < maxConsoleAccountSlots; i++ {
			credential, ok := consoleCredential(c, i)
			if !ok {
				continue
			}
			existing, err := s.loadConsoleSessionCredential(tx, credential)
			if err != nil || existing.AgentID != id || !validConsoleSessionAt(existing, now) {
				continue
			}
			if account != "" {
				var verified bool
				if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM console_v2_sessions s JOIN agent_owners o ON o.agent_id=s.agent_id AND o.owner_uid=s.owner_uid WHERE s.session_id=? AND s.auth_method='uid_password' AND s.status='active')`, existing.SessionID).Scan(&verified).Error; err != nil {
					return err
				}
				if !verified {
					continue
				}
			} else if existing.AuthMethod != "handoff" {
				continue
			}
			slot, reused = i, true
			return nil
		}
		// A registration reference never replaces an authenticated owner's session.
		if account != "" {
			return nil
		}
		replacement, err := parseReplacementAgentID(req.ReplaceAgentID)
		if err != nil {
			return errConflict
		}
		var oldSession string
		slot, oldSession, accountLimit, err = s.chooseConsoleSessionSlot(tx, c, id, replacement, now)
		if err != nil {
			return err
		}
		if oldSession != "" {
			if err := tx.Exec(`UPDATE console_v2_sessions SET status='revoked',revoked_at=? WHERE session_id=?`, now, oldSession).Error; err != nil {
				return err
			}
		}
		if sessionID, err = randomToken("efcs_", 18); err != nil {
			return err
		}
		if sessionSecret, err = randomToken("", 32); err != nil {
			return err
		}
		if csrf, err = randomToken("efcsrf_", 24); err != nil {
			return err
		}
		return tx.Exec(`INSERT INTO console_v2_sessions(session_id,session_secret_hash,agent_id,principal_id,csrf_secret_hash,status,scopes,client_capabilities,issued_at,idle_expires_at,absolute_expires_at,last_seen_at,auth_method)
		 VALUES(?,?,?,?,?,'active',?,?,?,?,?,?,'handoff')`, sessionID, hashString(sessionSecret), id, principal, hashString(csrf), pq.Array([]string{"console:onboarding", "console:read", "console:write"}), pq.Array(connection.Capabilities), now, now+int64(consoleIdleTTL/time.Millisecond), now+int64(consoleAbsoluteTTL/time.Millisecond), now).Error
	})
	if errors.Is(err, errUnauthorized) {
		fail(c, 401, "CONNECTION_INVALID", "无法打开注册页面，请从原 Agent 重新打开", nil)
		return
	}
	if errors.Is(err, errConsoleAccountLimit) {
		fail(c, 409, "CONSOLE_ACCOUNT_LIMIT_REACHED", "请先退出一个浏览器账号再继续", consoleAccountLimitDetails(accountLimit, id))
		return
	}
	if err != nil {
		fail(c, 500, "CONNECTION_FAILED", "注册页面暂时无法打开，请重试", nil)
		return
	}
	if account != "" && !reused {
		reply(c, 200, map[string]any{"agent_id": strconv.FormatInt(id, 10), "account": account, "requires_login": true})
		return
	}
	if !reused {
		s.setConsoleCookieAtSlot(c, slot, sessionID+"."+sessionSecret, int(consoleAbsoluteTTL/time.Second))
		s.setCSRFCookieAtSlot(c, slot, csrf, int(consoleAbsoluteTTL/time.Second))
	}
	s.setActiveConsoleSlot(c, slot, int(consoleAbsoluteTTL/time.Second))
	reply(c, 200, map[string]any{"agent_id": strconv.FormatInt(id, 10), "account": account, "requires_login": false, "account_switch": false})
}

func accountConnectionRequest(ticket string) bool {
	return strings.HasPrefix(ticket, accountConnectionPrefix)
}

// An installation/browser connection is only a registration context. It must
// not gain private account capabilities when that Agent finishes onboarding.
func (s *Service) accountConsoleAllowed(ctx context.Context, c *app.RequestContext, session consoleSession) bool {
	path := string(c.Path())
	switch path {
	case "/api/v2/console/session", "/api/v2/auth/uid/register", "/api/v2/auth/uid/claim", "/api/v2/auth/uid/switch", "/api/v2/auth/phone/challenges", "/api/v2/console/registration/progress", "/api/v2/console/account-switch", "/api/v2/console/accounts":
		return true
	}
	if strings.HasPrefix(path, "/api/v2/console/accounts/") {
		return true
	}
	if session.AuthMethod != "uid_password" {
		fail(c, 403, "OWNER_BINDING_REQUIRED", "请登录账号继续", nil)
		return false
	}
	var verified bool
	err := s.db.WithContext(ctx).Raw(`SELECT EXISTS(SELECT 1 FROM console_v2_sessions s JOIN agent_owners o ON o.agent_id=s.agent_id AND o.owner_uid=s.owner_uid WHERE s.session_id=? AND s.auth_method='uid_password' AND s.status='active')`, session.SessionID).Scan(&verified).Error
	if err != nil {
		fail(c, 503, "AUTH_UNAVAILABLE", "登录状态暂时无法核对，请重试", nil)
		return false
	}
	if !verified {
		fail(c, 403, "OWNER_BINDING_REQUIRED", "请登录账号继续", nil)
		return false
	}
	return true
}
