package consolev2

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"elsewhere_server/pkg/logger"
	"elsewhere_server/pkg/owneruid"
	"elsewhere_server/pkg/testaccountreset"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"os"
	"strconv"
	"strings"
	"time"
)

// Only identifiers needed to erase external copies persist during cleanup.
// This record is itself removed on success, before numbers can be reassigned.
type accountErasure struct {
	Owners      []string `json:"owners"`
	Agents      []int64  `json:"agents"`
	Items       []int64  `json:"items"`
	Posts       []int64  `json:"posts"`
	Services    []int64  `json:"services"`
	Keys        []string `json:"keys"`
	AgentOffset int      `json:"agent_offset,omitempty"`
	PostOffset  int      `json:"post_offset,omitempty"`
}
type accountDeletionJob struct {
	JobID, OwnerUID string
	Payload         []byte
	Attempts        int
}

func bindManagedAdminNumbers(db *gorm.DB) error {
	for _, value := range strings.Split(os.Getenv("AGENTNET_MANAGED_ADMIN_UIDS"), ",") {
		n := lookupOwnerNumber(strings.TrimSpace(value))
		if n == 0 {
			continue
		}
		if err := db.Exec(`INSERT INTO managed_admin_bindings(number,owner_uid) SELECT account_number,uid FROM human_accounts WHERE account_number=? ON CONFLICT(number) DO NOTHING`, n).Error; err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) registerAccountDeletion(h *server.Hertz) {
	h.DELETE("/api/v2/console/account", s.consoleAuth(true), s.deleteOwnAccount)
	h.GET("/api/v2/console/account/deletion-receipt", s.consoleAuth(false), s.prepareAccountDeletion)
	h.POST("/api/v2/account-deletion/status", s.accountDeletionStatus)
	h.POST("/api/v2/agent-account-deletion/status", s.agentDeletionStatus)
	if os.Getenv("AGENTNET_ACCOUNT_DELETION_WORKER") != "false" {
		go func() {
			for {
				if err := s.processAccountDeletion(context.Background(), s.eraseAccountExternal); err != nil {
					logger.Default().Warn("account erasure worker will retry")
				}
				time.Sleep(10 * time.Second)
			}
		}()
	}
}
func (s *Service) deletionReceipt(id string) string {
	mac := hmac.New(sha256.New, []byte(s.otpPepper))
	mac.Write([]byte("account-erasure:" + id))
	return id + "." + hex.EncodeToString(mac.Sum(nil))
}

// Preparing a receipt is read-only. It lets a browser reconcile a lost DELETE
// response without resubmitting the destructive request or retaining a password.
func (s *Service) prepareAccountDeletion(_ context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "private, no-store")
	owner, err := s.sessionOwner(c)
	if err != nil {
		fail(c, 403, "ACCOUNT_OWNER_REQUIRED", "请使用账号密码登录后注销", nil)
		return
	}
	id, err := randomToken("erase_", 24)
	if err != nil {
		uidFailure(c, err)
		return
	}
	reply(c, 200, map[string]any{"receipt": s.deletionReceipt(base64.RawURLEncoding.EncodeToString([]byte(owner)) + "~" + id)})
}
func (s *Service) readDeletionReceipt(receipt string) (owner, id string, ok bool) {
	if len(receipt) > 256 {
		return
	}
	parts := strings.Split(receipt, ".")
	if len(parts) != 2 || !hmac.Equal([]byte(s.deletionReceipt(parts[0])), []byte(receipt)) {
		return
	}
	fields := strings.Split(parts[0], "~")
	if len(fields) != 2 {
		return
	}
	raw, err := base64.RawURLEncoding.DecodeString(fields[0])
	if err != nil || len(raw) == 0 {
		return
	}
	return string(raw), fields[1], true
}
func (s *Service) accountDeletionStatus(_ context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "private, no-store")
	var req struct {
		Receipt string `json:"receipt"`
	}
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_REQUEST", "请重新打开注销进度", nil)
		return
	}
	owner, id, ok := s.readDeletionReceipt(req.Receipt)
	if !ok {
		fail(c, 403, "DELETION_RECEIPT_INVALID", "无法读取这次注销进度", nil)
		return
	}
	var pending bool
	if err := s.db.Raw(`SELECT EXISTS(SELECT 1 FROM account_deletion_jobs WHERE job_id=? OR owner_uid=?)`, id, owner).Scan(&pending).Error; err != nil {
		fail(c, 503, "DELETION_STATUS_UNAVAILABLE", "暂时无法确认注销进度，请稍后重试", nil)
		return
	}
	var exists bool
	if err := s.db.Raw(`SELECT EXISTS(SELECT 1 FROM human_accounts WHERE uid=?)`, owner).Scan(&exists).Error; err != nil {
		uidFailure(c, err)
		return
	}
	status := "completed"
	if exists {
		status = "not_started"
	}
	if pending {
		status = "pending"
	}
	reply(c, 200, map[string]any{"status": status})
}
func (s *Service) deleteOwnAccount(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "private, no-store")
	var req struct {
		Password     string `json:"password"`
		Confirmation string `json:"confirmation"`
		Receipt      string `json:"receipt"`
	}
	if decodeBody(c, &req) != nil || len(req.Password) > 72 || len(req.Confirmation) > 64 {
		fail(c, 400, "INVALID_REQUEST", "请填写当前密码和确认信息", nil)
		return
	}
	owner, err := s.sessionOwner(c)
	if err != nil {
		fail(c, 403, "ACCOUNT_OWNER_REQUIRED", "请使用账号密码登录后注销", nil)
		return
	}
	var account struct{ PasswordHash, Number string }
	if err = s.db.Raw(`SELECT password_hash,account_number::text AS number FROM human_accounts WHERE uid=?`, owner).Scan(&account).Error; err != nil {
		uidFailure(c, err)
		return
	}
	if !s.uidRate(ctx, c, "delete:"+owner) {
		return
	}
	if req.Confirmation != account.Number {
		fail(c, 400, "DELETION_CONFIRMATION_REQUIRED", "请输入当前账号的 UID 确认注销", nil)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(req.Password)) != nil {
		fail(c, 400, "DELETION_PASSWORD_INVALID", "当前密码不正确", nil)
		return
	}
	receiptOwner, id, ok := s.readDeletionReceipt(req.Receipt)
	if !ok || receiptOwner != owner {
		fail(c, 400, "DELETION_RECEIPT_INVALID", "请重新打开注销确认", nil)
		return
	}
	current, _ := agentID(c)
	slots := []int{}
	for slot := 0; slot < maxConsoleAccountSlots; slot++ {
		if credential, ok := consoleCredential(c, slot); ok {
			if session, e := s.loadConsoleSessionCredential(s.db, credential); e == nil && session.AgentID == current {
				slots = append(slots, slot)
			}
		}
	}
	if err = s.beginAccountDeletion(ctx, id, owner, account.PasswordHash, phoneSession(c)); err != nil {
		if errors.Is(err, errUnauthorized) {
			fail(c, 403, "ACCOUNT_OWNER_REQUIRED", "请使用账号本人的密码登录后注销", nil)
			return
		}
		fail(c, 503, "ACCOUNT_DELETION_FAILED", "注销尚未开始，请稍后重试", nil)
		return
	}
	for _, slot := range slots {
		s.setConsoleCookieAtSlot(c, slot, "", -1)
		s.setCSRFCookieAtSlot(c, slot, "", -1)
	}
	s.setActiveConsoleSlot(c, 0, -1)
	reply(c, 202, map[string]any{"status": "pending", "receipt": req.Receipt})
}

func (s *Service) beginAccountDeletion(ctx context.Context, id, owner, hash, session string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Match allocation/managed publishing lock order. Ownership FKs also fence
		// background writes that started before the request's authentication.
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817611); SELECT pg_advisory_xact_lock(734817615)`).Error; err != nil {
			return err
		}
		var valid bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM console_v2_sessions cs JOIN human_accounts h ON h.uid=cs.owner_uid JOIN agent_owners o ON o.owner_uid=h.uid AND o.agent_id=cs.agent_id
   WHERE cs.session_id=? AND cs.owner_uid=? AND cs.status='active' AND cs.auth_method='uid_password' AND h.password_hash=?
   AND NOT EXISTS(SELECT 1 FROM managed_delegations d WHERE d.session_id=cs.session_id))`, session, owner, hash).Scan(&valid).Error; err != nil {
			return err
		}
		if !valid {
			return errUnauthorized
		}
		if err := bindManagedAdminNumbers(tx); err != nil {
			return err
		}
		var p accountErasure
		if err := tx.Raw(`WITH RECURSIVE owned(uid) AS (SELECT ?::varchar(64) UNION SELECT m.owner_uid FROM managed_members m JOIN owned o ON m.sponsor_uid=o.uid) SELECT uid FROM owned`, owner).Scan(&p.Owners).Error; err != nil {
			return err
		}
		if err := tx.Raw(`SELECT uid FROM human_accounts WHERE uid IN ? ORDER BY uid FOR UPDATE`, p.Owners).Scan(&p.Owners).Error; err != nil {
			return err
		}
		if err := tx.Raw(`SELECT a.agent_id FROM agents a JOIN agent_owners o USING(agent_id) WHERE o.owner_uid IN ? ORDER BY a.agent_id FOR UPDATE OF a`, p.Owners).Scan(&p.Agents).Error; err != nil {
			return err
		}
		if len(p.Agents) == 0 {
			return errUnauthorized
		}
		if err := eraseAccountSourceCopies(tx, p.Agents); err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM human_phone_challenges WHERE phone_hash IN (SELECT phone_hash FROM human_accounts WHERE uid IN ?)`, p.Owners).Error; err != nil {
			return err
		}
		// Indirect copies are not always foreign keys (outboxes, inbox payloads,
		// email conflict snapshots). Erase those before cascading source rows.
		if err := tx.Exec(`DELETE FROM agent_signature_nonces WHERE key_fingerprint IN (SELECT key_fingerprint FROM agent_principals WHERE agent_id IN ?)`, p.Agents).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM agent_bootstrap_grants WHERE key_fingerprint IN (SELECT key_fingerprint FROM agent_principals WHERE agent_id IN ?)`, p.Agents).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM v2_email_challenges WHERE normalized_email_hash IN (SELECT normalized_email_hash FROM v2_email_challenges WHERE subject_agent_id IN ?)`, p.Agents).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM console_v2_email_conflicts WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(agent_ids) n WHERE n::text=ANY(?))`, pq.Array(agentStrings(p.Agents))).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM notification_inbox WHERE order_id IN (SELECT order_id FROM trade_orders WHERE buyer_agent_id IN ? OR seller_agent_id IN ?)`, p.Agents, p.Agents).Error; err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM trade_outbox WHERE payload_json->>'order_id' IN (SELECT order_id::text FROM trade_orders WHERE buyer_agent_id IN ? OR seller_agent_id IN ?) OR payload_json->>'agent_id'=ANY(?) OR payload_json->>'seller_agent_id'=ANY(?)`, p.Agents, p.Agents, pq.Array(agentStrings(p.Agents)), pq.Array(agentStrings(p.Agents))).Error; err != nil {
			return err
		}
		for _, q := range []struct {
			sql  string
			dest *[]int64
		}{
			{`SELECT item_id FROM raw_items WHERE author_agent_id IN ?`, &p.Items},
			{`SELECT post_id FROM social_work_posts WHERE agent_id IN ?`, &p.Posts},
			{`SELECT service_id FROM trading_services WHERE seller_agent_id IN ?`, &p.Services},
		} {
			if err := tx.Raw(q.sql, p.Agents).Scan(q.dest).Error; err != nil {
				return err
			}
		}
		for _, agent := range p.Agents {
			var report testaccountreset.Report
			report.AgentID = agent
			if err := tx.Raw(`SELECT email FROM agents WHERE agent_id=?`, agent).Scan(&report.Email).Error; err != nil {
				return err
			}
			if err := tx.Raw(`SELECT token_hash FROM agent_sessions WHERE agent_id=?`, agent).Scan(&report.TokenHashes).Error; err != nil {
				return err
			}
			if err := tx.Raw(`SELECT conv_id AS id,participant_a AS a,participant_b AS b,COALESCE(origin_id,0) AS origin FROM conversations WHERE participant_a=? OR participant_b=?`, agent, agent).Scan(&report.Convs).Error; err != nil {
				return err
			}
			if err := tx.Raw(`SELECT to_uid FROM user_relations WHERE from_uid=? UNION SELECT from_uid FROM user_relations WHERE to_uid=?`, agent, agent).Scan(&report.Peers).Error; err != nil {
				return err
			}
			p.Keys = append(p.Keys, testaccountreset.RedisKeys(&report, os.Getenv("RECALL_REDIS_NAMESPACE"))...)
			for _, query := range []string{`DELETE FROM auth_email_challenges WHERE email=?`, `DELETE FROM console_v2_email_conflicts WHERE normalized_email=?`} {
				if err := tx.Exec(query, report.Email).Error; err != nil {
					return err
				}
			}
		}
		for _, q := range []string{
			`UPDATE agents SET inviter_agent_id=NULL,invited_by_code=NULL WHERE inviter_agent_id IN ?`,
			`DELETE FROM agent_feed_exposures WHERE author_agent_id IN ?`,
			`DELETE FROM console_usage_sessions WHERE agent_id IN ?`,
			`DELETE FROM telemetry_events_v2 WHERE agent_id IN ?`,
			`DELETE FROM agent_bootstrap_grants WHERE consumed_by_agent_id IN ?`,
		} {
			if err := tx.Exec(q, p.Agents).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec(`DELETE FROM twin_relationships WHERE target_id=ANY(?) OR target_id=ANY(?)`, pq.Array(p.Owners), pq.Array(agentStrings(p.Agents))).Error; err != nil {
			return err
		}
		profileIDs := append(append([]string{}, p.Owners...), agentStrings(p.Agents)...)
		for _, table := range []string{"twin_users", "legacy_profile_archives", "twin_agreement_acceptances"} {
			if err := tx.Exec("DELETE FROM "+table+" WHERE user_id IN ?", profileIDs).Error; err != nil {
				return err
			}
		}
		if err := s.retainAgentDeletionProofs(tx, p.Agents); err != nil {
			return err
		}
		if err := eraseCollaboration(tx, p.Agents); err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM agents WHERE agent_id IN ?`, p.Agents).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE human_accounts SET password_hash='!erasure-pending',recovery_hash='!erasure-pending' WHERE uid IN ?`, p.Owners).Error; err != nil {
			return err
		}
		raw, err := json.Marshal(p)
		if err != nil {
			return err
		}
		return tx.Exec(`INSERT INTO account_deletion_jobs(job_id,owner_uid,payload,created_at) VALUES(?,?,?::jsonb,?)`, id, owner, string(raw), time.Now().UnixMilli()).Error
	})
}

// Polymorphic inbox/attention references cannot use ordinary source FKs.
// Delete their copies while their source IDs are still available.
func eraseAccountSourceCopies(tx *gorm.DB, agents []int64) error {
	sources := `WITH removed AS (
 SELECT 'broadcast' AS kind,item_id AS id FROM raw_items WHERE author_agent_id=ANY(?)
 UNION ALL SELECT kind,post_id FROM social_work_posts CROSS JOIN (VALUES('post'),('work_post'),('social_post')) kinds(kind) WHERE agent_id=ANY(?)
 UNION ALL SELECT 'post_comment',comment_id FROM social_work_comments WHERE agent_id=ANY(?) OR post_id IN (SELECT post_id FROM social_work_posts WHERE agent_id=ANY(?))
 UNION ALL SELECT 'private_message',msg_id FROM private_messages WHERE sender_id=ANY(?) OR receiver_id=ANY(?)
 UNION ALL SELECT 'group_message',msg_id FROM social_group_messages WHERE sender_id=ANY(?) OR group_id IN (SELECT group_id FROM social_groups WHERE creator_id=ANY(?))
 UNION ALL SELECT 'friend_request',id FROM friend_requests WHERE from_uid=ANY(?) OR to_uid=ANY(?)
 UNION ALL SELECT 'milestone',event_id FROM milestone_events WHERE author_agent_id=ANY(?)
 UNION ALL SELECT 'project_handoff',handoff_id FROM project_handoffs WHERE sender_id=ANY(?) OR receiver_id=ANY(?)
 ) `
	args := make([]any, 13)
	for i := range args {
		args[i] = pq.Array(agents)
	}
	for _, q := range []string{
		`DELETE FROM moment_inbox_views v USING removed r WHERE v.source_kind=r.kind AND v.source_id=r.id`,
		`DELETE FROM notification_deliveries n USING removed r WHERE n.source_type=r.kind AND n.source_id=r.id`,
		`DELETE FROM notification_inbox n USING removed r WHERE n.source_type=r.kind AND n.source_id=r.id`,
		`DELETE FROM agent_attention_items a USING removed r WHERE (a.source_type=r.kind AND a.source_id=r.id) OR (COALESCE(a.source_ref->>'kind',a.source_ref->>'type')=r.kind AND a.source_ref->>'id'=r.id::text)`,
	} {
		if err := tx.Exec(sources+q, args...).Error; err != nil {
			return err
		}
	}
	return nil
}
func agentStrings(ids []int64) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = strconv.FormatInt(id, 10)
	}
	return out
}

// Locked jobs are restart-safe and idempotent across API replicas. No phone or
// UID is released on an external failure, and no provider error is persisted.
func (s *Service) processAccountDeletion(ctx context.Context, erase func(context.Context, accountErasure) error) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var job accountDeletionJob
		if err := tx.Raw(`SELECT job_id,owner_uid,payload,attempts FROM account_deletion_jobs WHERE next_attempt_at<=? ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, time.Now().UnixMilli()).Scan(&job).Error; err != nil {
			return err
		}
		if job.JobID == "" {
			return nil
		}
		var p accountErasure
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return err
		}
		if p.AgentOffset < 0 || p.AgentOffset > len(p.Agents) || p.PostOffset < 0 || p.PostOffset > len(p.Posts) {
			return errors.New("invalid erasure progress")
		}
		// Persist bounded progress so large accounts do not restart thousands of
		// external deletions after every timeout. Original IDs stay until finalization.
		batch := p
		agentEnd := min(p.AgentOffset+10, len(p.Agents))
		postEnd := min(p.PostOffset+10, len(p.Posts))
		batch.Agents = p.Agents[p.AgentOffset:agentEnd]
		batch.Posts = p.Posts[p.PostOffset:postEnd]
		if err := erase(ctx, batch); err != nil {
			logger.Default().Warn("account erasure external cleanup will retry; reservations retained")
			return tx.Exec(`UPDATE account_deletion_jobs SET attempts=attempts+1,next_attempt_at=? WHERE job_id=?`, time.Now().Add(time.Minute).UnixMilli(), job.JobID).Error
		}
		if agentEnd < len(p.Agents) || postEnd < len(p.Posts) {
			p.AgentOffset = agentEnd
			p.PostOffset = postEnd
			raw, err := json.Marshal(p)
			if err != nil {
				return err
			}
			return tx.Exec(`UPDATE account_deletion_jobs SET payload=?::jsonb,next_attempt_at=0 WHERE job_id=?`, string(raw), job.JobID).Error
		}
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817611)`).Error; err != nil {
			return err
		}
		for _, owner := range p.Owners {
			if err := tx.Exec(`DELETE FROM owner_uid_admin_events WHERE detail->>'number'=(SELECT account_number::text FROM human_accounts WHERE uid=?) OR detail->>'agent_id'=ANY(?) OR actor=? OR detail->>'owner_uid'=?`, owner, pq.Array(agentStrings(p.Agents)), owner, owner).Error; err != nil {
				return err
			}
			if err := tx.Exec(`DELETE FROM human_accounts WHERE uid=?`, owner).Error; err != nil {
				return err
			}
			if err := owneruid.Release(tx, owner); err != nil {
				return err
			}
		}
		return tx.Exec(`DELETE FROM account_deletion_jobs WHERE job_id=?`, job.JobID).Error
	})
}
