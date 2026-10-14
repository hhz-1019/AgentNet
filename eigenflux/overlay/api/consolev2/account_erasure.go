package consolev2

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var errErasureBlocked = errors.New("account erasure requires ownership or transaction resolution")

type erasurePreview struct {
	Account  string `json:"account"`
	Agents   int64  `json:"agents"`
	Posts    int64  `json:"posts"`
	Messages int64  `json:"messages"`
	Memories int64  `json:"memories"`
}

type erasureRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
	Confirm  bool   `json:"confirm"`
}

func (s *Service) registerAccountErasureRoutes(h *server.Hertz) {
	h.GET("/api/v2/console/account", s.consoleAuth(false), s.getAccountErasure)
	h.DELETE("/api/v2/console/account", s.consoleAuth(true), s.deleteAccount)
	// The queue is persisted; a restart never loses external cleanup work.
	go s.accountErasureLoop()
}

// Only a real owner's password session can erase an account. Runtime handoffs,
// delegated operator sessions and agent bearer tokens cannot use this route.
func erasureOwner(tx *gorm.DB, c *app.RequestContext) (uidAccount, error) {
	session, ok := c.Get("console_session_id")
	if !ok {
		return uidAccount{}, errUnauthorized
	}
	var account uidAccount
	now := time.Now().UnixMilli()
	err := tx.Raw(`SELECT h.uid,h.account_number::text AS number,h.password_hash
 FROM console_v2_sessions s JOIN human_accounts h ON h.uid=s.owner_uid
 JOIN agent_owners o ON o.owner_uid=h.uid AND o.agent_id=s.agent_id
 WHERE s.session_id=? AND s.status='active' AND s.auth_method='uid_password'
 AND s.idle_expires_at>? AND s.absolute_expires_at>?
 AND NOT EXISTS(SELECT 1 FROM managed_delegations d WHERE d.session_id=s.session_id)`, session, now, now).Scan(&account).Error
	if err != nil {
		return account, err
	}
	if account.UID == "" {
		return account, errUnauthorized
	}
	return account, nil
}

func accountErasurePreview(tx *gorm.DB, owner string) (erasurePreview, error) {
	var p erasurePreview
	err := tx.Raw(`SELECT h.account_number::text AS account,
 (SELECT count(*) FROM agent_owners WHERE owner_uid=h.uid) AS agents,
 (SELECT count(*) FROM social_work_posts WHERE agent_id IN (SELECT agent_id FROM agent_owners WHERE owner_uid=h.uid)) AS posts,
 (SELECT count(*) FROM private_messages WHERE sender_id IN (SELECT agent_id FROM agent_owners WHERE owner_uid=h.uid) OR receiver_id IN (SELECT agent_id FROM agent_owners WHERE owner_uid=h.uid)) AS messages,
 (SELECT count(*) FROM portrait_memories WHERE user_id=h.uid) AS memories
 FROM human_accounts h WHERE uid=?`, owner).Scan(&p).Error
	return p, err
}

func (s *Service) getAccountErasure(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	account, err := erasureOwner(s.db.WithContext(ctx), c)
	if err != nil {
		erasureFailure(c, err)
		return
	}
	preview, err := accountErasurePreview(s.db.WithContext(ctx), account.UID)
	if err != nil {
		erasureFailure(c, err)
		return
	}
	reply(c, 200, preview)
}

func (s *Service) deleteAccount(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "no-store")
	var req erasureRequest
	if err := decodeBody(c, &req); err != nil || !req.Confirm || lookupOwnerNumber(req.Account) == 0 || len(req.Password) == 0 || len(req.Password) > 72 {
		fail(c, 400, "ERASURE_CONFIRMATION_REQUIRED", "请输入账号、当前密码并确认永久注销", nil)
		return
	}
	account, err := erasureOwner(s.db.WithContext(ctx), c)
	if err != nil {
		erasureFailure(c, err)
		return
	}
	if !s.uidRate(ctx, c, account.UID) {
		return
	}
	if account.Number != req.Account || bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(req.Password)) != nil {
		fail(c, 403, "ERASURE_AUTH_INVALID", "账号或当前密码不正确", nil)
		return
	}
	// Save the cookie slots belonging to this owner before removing their sessions.
	slots := []int{}
	for i := 0; i < maxConsoleAccountSlots; i++ {
		credential, ok := consoleCredential(c, i)
		if !ok {
			continue
		}
		var owned bool
		if err = s.db.Raw(`SELECT EXISTS(SELECT 1 FROM console_v2_sessions WHERE session_id=? AND owner_uid=?)`, credential.SessionID, account.UID).Scan(&owned).Error; err != nil {
			erasureFailure(c, err)
			return
		}
		if owned {
			slots = append(slots, i)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended('account-erasure:'||?,0))", account.UID).Error; e != nil {
			return e
		}
		if e := lockUID(tx, account); e != nil {
			return e
		}
		verified, e := erasureOwner(tx, c)
		if e != nil || verified.UID != account.UID {
			return errUnauthorized
		}
		var ids []int64
		if e = tx.Raw(`SELECT agent_id FROM agent_owners WHERE owner_uid=? ORDER BY agent_id`, account.UID).Scan(&ids).Error; e != nil {
			return e
		}
		return eraseIdentityData(tx, account, ids)
	})
	if err != nil {
		erasureFailure(c, err)
		return
	}
	for _, slot := range slots {
		s.setConsoleCookieAtSlot(c, slot, "", -1)
		s.setCSRFCookieAtSlot(c, slot, "", -1)
	}
	s.setActiveConsoleSlot(c, 0, -1)
	reply(c, http.StatusOK, map[string]any{"deleted": true, "cleanup_pending": true})
}

func nonNilIDs(ids []int64) []int64 {
	if ids == nil {
		return []int64{}
	}
	return ids
}

func checkErasureBlockers(tx *gorm.DB, a uidAccount, ids []int64) error {
	if managedAdminNumber(a.Number) {
		return errErasureBlocked
	}
	var blocked bool
	err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_members WHERE owner_uid=? OR sponsor_uid=? OR agent_id=ANY(?))
 OR EXISTS(SELECT 1 FROM agents WHERE agent_id=ANY(?) AND is_official)
 OR EXISTS(SELECT 1 FROM social_groups WHERE creator_id=ANY(?))
 OR EXISTS(SELECT 1 FROM social_organizations WHERE owner_agent_id=ANY(?))
 OR EXISTS(SELECT 1 FROM trading_services WHERE seller_agent_id=ANY(?))
 OR EXISTS(SELECT 1 FROM trade_order_events WHERE actor_agent_id=ANY(?))
 OR EXISTS(SELECT 1 FROM trade_orders WHERE buyer_agent_id=ANY(?) OR seller_agent_id=ANY(?))`, a.UID, a.UID, pq.Array(ids), pq.Array(ids), pq.Array(ids), pq.Array(ids), pq.Array(ids), pq.Array(ids), pq.Array(ids), pq.Array(ids)).Scan(&blocked).Error
	if err != nil {
		return err
	}
	if blocked {
		return errErasureBlocked
	}
	return nil
}

func erasureFailure(c *app.RequestContext, err error) {
	switch {
	case errors.Is(err, errUnauthorized):
		fail(c, 403, "ERASURE_OWNER_REQUIRED", "请登录需要注销的账号", nil)
	case errors.Is(err, errErasureBlocked):
		fail(c, 409, "ERASURE_BLOCKED", "请先转交群组或组织、处理交易或托管身份，再注销账号", nil)
	default:
		fail(c, 503, "ERASURE_UNAVAILABLE", "注销未完成，账号数据已保留，请稍后重试", nil)
	}
}

// Keep decimal IDs out of floating point paths, including external cleanup.
func decimalIDs(ids []int64) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = strconv.FormatInt(id, 10)
	}
	return out
}

func eraseIdentityData(tx *gorm.DB, account uidAccount, ids []int64) error {
	job, e := randomToken("erase_", 18)
	if e != nil {
		return e
	}
	for _, id := range ids {
		if e = tx.Exec(`SELECT pg_advisory_xact_lock(?)`, id).Error; e != nil {
			return e
		}
	}
	if len(ids) > 0 {
		if e = tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=ANY(?) ORDER BY agent_id FOR UPDATE`, pq.Array(ids)).Error; e != nil {
			return e
		}
	}
	if e = checkErasureBlockers(tx, account, ids); e != nil {
		return e
	}
	var items []int64
	if e = tx.Raw(`SELECT item_id FROM raw_items WHERE author_agent_id=ANY(?) ORDER BY item_id FOR UPDATE`, pq.Array(ids)).Scan(&items).Error; e != nil {
		return e
	}
	for _, item := range items {
		if e = tx.Exec("SELECT pg_advisory_xact_lock(?)", item).Error; e != nil {
			return e
		}
	}
	cacheKeys, e := erasureCacheKeys(tx, ids)
	if e != nil {
		return e
	}
	if e = eraseAccountRows(tx, account, ids, items); e != nil {
		return e
	}
	for _, id := range ids {
		if e = tx.Exec(`INSERT INTO erased_agent_ids VALUES(?) ON CONFLICT DO NOTHING`, id).Error; e != nil {
			return e
		}
	}
	for _, id := range items {
		if e = tx.Exec(`INSERT INTO erased_item_ids VALUES(?) ON CONFLICT DO NOTHING`, id).Error; e != nil {
			return e
		}
	}
	if e = tx.Exec("INSERT INTO erased_owner_ids VALUES(?) ON CONFLICT DO NOTHING", account.UID).Error; e != nil {
		return e
	}
	now := time.Now().UnixMilli()
	return tx.Exec(`INSERT INTO account_erasure_jobs(job_id,agent_ids,item_ids,redis_keys,created_at,next_attempt_at) VALUES(?,?,?,?,?,?)`, job, pq.Array(nonNilIDs(ids)), pq.Array(nonNilIDs(items)), pq.Array(cacheKeys), now, now).Error
}
