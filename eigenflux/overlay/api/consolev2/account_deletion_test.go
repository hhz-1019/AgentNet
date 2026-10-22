package consolev2

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"eigenflux_server/pkg/owneruid"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/alicebob/miniredis/v2"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAccountDeletionLifecycle(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	db := socialFixtureDB(t, dsn)
	r := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: r.Addr()})
	defer client.Close()
	s := &Service{db: db, redisClient: client, otpPepper: "deletion-test", idgen: &managedTestIDs{id: 807000}, publicURL: "https://test.invalid"}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	exec := func(q string, args ...any) { t.Helper(); check(db.Exec(q, args...).Error) }
	count := func(q string, args ...any) int64 {
		t.Helper()
		var n int64
		check(db.Raw(q, args...).Scan(&n).Error)
		return n
	}
	now := time.Now().UnixMilli()
	exec(`INSERT INTO invite_codes(code,kind,name,created_at) VALUES('erase-channel','channel','system-channel',1)`)
	const owner = "erase_owner"
	const id int64 = 807001
	const peer int64 = 807002
	const password = "erase-fixture-password"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	check(err)
	check(insertProvisionedAgent(db, id, "erase@identity.invalid", "待注销", now))
	check(insertProvisionedAgent(db, peer, "erase-peer@identity.invalid", "保留", now))
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	check(err)
	exec(`INSERT INTO agent_principals(agent_id,key_fingerprint,public_key,created_at,last_seen_at) VALUES(?,?,?,?,?)`, id, fingerprint(publicKey), []byte(publicKey), now, now)
	var number int64
	check(db.Transaction(func(tx *gorm.DB) error {
		var e error
		number, e = owneruid.AllocateForOwner(tx, id, owner, now)
		if e != nil {
			return e
		}
		if e = tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at) VALUES(?,?,?,'old-recovery','fixture-phone','8000',?,?)`, owner, number, string(hash), now, now).Error; e != nil {
			return e
		}
		return tx.Exec(`INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(?,?,?)`, id, owner, now).Error
	}))
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", fmt.Sprint(number))
	exec(`INSERT INTO invite_codes(code,kind,agent_id,created_at) VALUES('erase-own','kol',?,1)`, id)
	exec(`INSERT INTO trade_orders(order_id,service_id,buyer_agent_id,seller_agent_id,frozen_title,frozen_amount_atomic,frozen_asset,frozen_delivery_deadline_ms,created_at,deadline_at) VALUES(807051,807052,?,?,'旧订单',1,'TEST',1000,1,1001)`, id, peer)
	exec(`INSERT INTO trade_order_events(event_id,order_id,event_type,created_at) VALUES(807053,807051,6,1)`)
	var session uidSession
	c := app.NewContext(0)
	check(db.Transaction(func(tx *gorm.DB) error { var e error; session, e = s.newUIDSession(tx, c, owner, id, now); return e }))
	secure := server.New()
	secure.DELETE("/account", s.consoleAuth(true), s.deleteOwnAccount)
	secure.GET("/receipt", s.consoleAuth(false), s.prepareAccountDeletion)
	cookie := consoleSessionCookieName(session.Slot) + "=" + session.ID + "." + session.Secret + "; " + consoleCSRFCookieName(session.Slot) + "=" + session.CSRF
	headers := []ut.Header{{Key: "Cookie", Value: cookie}, {Key: "Origin", Value: "https://test.invalid"}, {Key: "Content-Type", Value: "application/json"}}
	if w := ut.PerformRequest(secure.Engine, "DELETE", "/account", nil, headers...); w.Code != 403 {
		t.Fatal("CSRF not enforced", w.Code, w.Body.String())
	}
	if w := ut.PerformRequest(secure.Engine, "GET", "/receipt", nil); w.Code != 401 {
		t.Fatal("anonymous receipt", w.Code)
	}
	if w := ut.PerformRequest(secure.Engine, "GET", "/receipt", nil, headers...); w.Code != 200 {
		t.Fatal("owner receipt", w.Code, w.Body.String())
	}
	exec(`INSERT INTO twin_users(user_id,name,basic_info,created_at,last_active_at) VALUES(?,'旧画像','{"secret":"old"}',?,?)`, owner, now, now)
	exec(`INSERT INTO portrait_memories(user_id,memory_id,content,created_at,updated_at) VALUES(?,'00000000-0000-0000-0000-000000807001','不应恢复的记忆',?,?)`, owner, now, now)
	exec(`INSERT INTO agent_activity_memory(agent_id,scope,revision,pending,next_check_at,updated_at) VALUES(?,'daily',1,'旧活动记忆',0,?)`, id, now)
	exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at) VALUES(807011,?,'published',1,'public','{"body":"删除内容"}',?),(807012,?,'published',1,'public','{"body":"保留内容"}',?)`, id, now, peer, now)
	exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at) VALUES(807021,807012,?,'删除评论','erase-c1',?)`, id, now)
	exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at,reply_to_comment_id) VALUES(807022,807012,?,'保留回复','erase-c2',?,807021)`, peer, now)
	exec(`INSERT INTO social_work_reactions(post_id,agent_id,kind) VALUES(807012,?,'like')`, id)
	exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES(807031,?,'private','image/png',?)`, id, now)
	exec(`INSERT INTO raw_items(item_id,author_agent_id,raw_content,created_at) VALUES(807041,?,'旧广播',?)`, id, now)
	exec(`INSERT INTO processed_items(item_id,status,summary,updated_at) VALUES(807041,1,'旧索引',?)`, now)
	exec(`INSERT INTO human_phone_challenges(challenge_id,phone_hash,otp_hash,session_id,purpose,delivery_state,created_at,expires_at) VALUES('erase-phone','fixture-phone','otp',?,'bind','sent',?,?)`, session.ID, now, now+60000)
	// Test handlers with trusted context injection; middleware itself is exercised
	// below on a second router with actual session/CSRF credentials.
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) {
		c.Set("agent_id", id)
		c.Set("console_session_id", session.ID)
		c.Next(ctx)
	}
	h.DELETE("/delete", inject, s.deleteOwnAccount)
	h.POST("/status", s.accountDeletionStatus)
	h.POST("/agent-status", s.agentDeletionStatus)
	receipt := s.deletionReceipt(base64.RawURLEncoding.EncodeToString([]byte(owner)) + "~erase_test")
	request := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(body)
		w := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: bytes.NewReader(raw), Len: len(raw)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		var value map[string]any
		check(json.Unmarshal(w.Body.Bytes(), &value))
		return w.Code, value
	}
	statusOf := func() string {
		t.Helper()
		code, value := request("POST", "/status", map[string]any{"receipt": receipt})
		if code != 200 {
			t.Fatal(value)
		}
		return value["data"].(map[string]any)["status"].(string)
	}
	if statusOf() != "not_started" {
		t.Fatal("prepared receipt claimed success")
	}
	agentStatus := func(agent int64, key ed25519.PrivateKey, age time.Duration, mutate bool) (int, string) {
		t.Helper()
		nonce := strings.Repeat("n", 32)
		issuedAt := time.Now().Add(age).UnixMilli()
		body := map[string]any{"agent_id": fmt.Sprint(agent), "public_key": base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey)), "issued_at": issuedAt, "nonce": nonce}
		body["signature"] = base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(fmt.Sprintf("ELSEWHERE-ACCOUNT-DELETION-V1\n%d\n%d\n%s", agent, issuedAt, nonce))))
		if mutate {
			body["agent_id"] = fmt.Sprint(agent + 1)
		}
		code, value := request("POST", "/agent-status", body)
		if code != 200 {
			return code, ""
		}
		data := value["data"].(map[string]any)
		if data["nonce"] != nonce || data["agent_id"] != fmt.Sprint(agent) {
			t.Fatal("status response not bound to request", data)
		}
		return code, data["status"].(string)
	}
	if code, status := agentStatus(id, privateKey, 0, false); code != 200 || status != "not_deleted" {
		t.Fatal("active account marked deleted", code, status)
	}
	for _, body := range []map[string]any{
		{"password": "wrong", "confirmation": fmt.Sprint(number), "receipt": receipt},
		{"password": password, "confirmation": "wrong", "receipt": receipt},
		{"password": password, "confirmation": fmt.Sprint(number), "receipt": receipt + "tampered"},
	} {
		code, _ := request("DELETE", "/delete", body)
		if code == 202 {
			t.Fatal("invalid confirmation deleted account")
		}
	}
	if count(`SELECT count(*) FROM agents WHERE agent_id=?`, id) != 1 {
		t.Fatal("rejected request mutated account")
	}
	// Any failure rolls back the whole graph, including sessions and content.
	exec(`CREATE FUNCTION reject_erasure_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$`)
	exec(`CREATE TRIGGER reject_erasure_fixture BEFORE DELETE ON agents FOR EACH ROW EXECUTE FUNCTION reject_erasure_fixture()`)
	if err = s.beginAccountDeletion(context.Background(), "rollback", owner, string(hash), session.ID); err == nil {
		t.Fatal("expected rollback")
	}
	exec(`DROP TRIGGER reject_erasure_fixture ON agents; DROP FUNCTION reject_erasure_fixture()`)
	if count(`SELECT count(*) FROM social_work_posts WHERE agent_id=?`, id) != 1 {
		t.Fatal("partial deletion")
	}
	if count(`SELECT count(*) FROM agent_account_deletions`) != 0 {
		t.Fatal("rolled back deletion retained proof")
	}
	exec(`INSERT INTO managed_delegations(session_id,sponsor_uid) VALUES(?,?)`, session.ID, owner)
	if err = s.beginAccountDeletion(context.Background(), "delegated", owner, string(hash), session.ID); err == nil {
		t.Fatal("delegated session deleted owner")
	}
	exec(`DELETE FROM managed_delegations WHERE session_id=?`, session.ID)
	code, value := request("DELETE", "/delete", map[string]any{"password": password, "confirmation": fmt.Sprint(number), "receipt": receipt})
	if code != 202 {
		t.Fatal(code, value)
	}
	if statusOf() != "pending" {
		t.Fatal("missing pending receipt")
	}
	if w := ut.PerformRequest(secure.Engine, "GET", "/receipt", nil, headers...); w.Code != 401 {
		t.Fatal("old session still accepted", w.Code)
	}
	for _, q := range []string{
		`SELECT count(*) FROM agents WHERE agent_id=807001`,
		`SELECT count(*) FROM console_v2_sessions WHERE agent_id=807001`,
		`SELECT count(*) FROM agent_principals WHERE agent_id=807001`,
		`SELECT count(*) FROM social_work_posts WHERE agent_id=807001`,
		`SELECT count(*) FROM social_media WHERE agent_id=807001`,
		`SELECT count(*) FROM portrait_memories WHERE user_id='erase_owner'`,
		`SELECT count(*) FROM twin_users WHERE user_id='erase_owner'`,
		`SELECT count(*) FROM agent_activity_memory WHERE agent_id=807001`,
		`SELECT count(*) FROM processed_items WHERE item_id=807041`,
		`SELECT count(*) FROM human_phone_challenges WHERE phone_hash='fixture-phone'`,
		`SELECT count(*) FROM trade_order_events WHERE order_id=807051`,
		`SELECT count(*) FROM invite_codes WHERE code='erase-own'`,
	} {
		if count(q) != 0 {
			t.Fatal("data retained", q)
		}
	}
	if count(`SELECT count(*) FROM social_work_comments WHERE comment_id=807022 AND reply_to_comment_id IS NULL`) != 1 || count(`SELECT like_count FROM social_work_posts WHERE post_id=807012`) != 0 {
		t.Fatal("peer reply or counts corrupted")
	}
	if count(`SELECT count(*) FROM agents WHERE agent_id=?`, peer) != 1 {
		t.Fatal("peer deleted")
	}
	if count(`SELECT count(*) FROM invite_codes WHERE code='erase-channel' AND agent_id=0`) != 1 {
		t.Fatal("system channel removed")
	}
	if db.Exec(`INSERT INTO agent_activity_memory(agent_id,scope,revision,pending,next_check_at,updated_at) VALUES(807001,'daily',1,'late write',0,1)`).Error == nil {
		t.Fatal("late write resurrected memory")
	}
	check(s.processAccountDeletion(context.Background(), func(_ context.Context, p accountErasure) error {
		if len(p.Items) != 1 || p.Items[0] != 807041 || len(p.Posts) != 1 {
			t.Fatal("missing projection IDs", p)
		}
		return errors.New("external store offline")
	}))
	if count(`SELECT count(*) FROM human_accounts WHERE phone_hash='fixture-phone'`) != 1 || count(`SELECT count(*) FROM owner_uid_numbers WHERE number=?`, number) != 1 {
		t.Fatal("released before external erasure")
	}
	exec(`UPDATE account_deletion_jobs SET next_attempt_at=0`)
	check(s.processAccountDeletion(context.Background(), func(context.Context, accountErasure) error { return nil }))
	if statusOf() != "completed" || count(`SELECT count(*) FROM human_accounts WHERE phone_hash='fixture-phone'`) != 0 || count(`SELECT count(*) FROM owner_uid_numbers WHERE number=?`, number) != 0 {
		t.Fatal("resources not released")
	}
	if count(`SELECT count(*) FROM account_deletion_jobs`) != 0 {
		t.Fatal("erasure manifest retained")
	}
	if code, status := agentStatus(id, privateKey, 0, false); code != 200 || status != "deleted" {
		t.Fatal("offline host cannot confirm after erasure", code, status)
	}
	if code, status := agentStatus(id+2, privateKey, 0, false); code != 200 || status != "not_deleted" {
		t.Fatal("reused key inherited deletion", code, status)
	}
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	if code, status := agentStatus(id, otherKey, 0, false); code != 200 || status != "not_deleted" {
		t.Fatal("other key learned account deletion", code, status)
	}
	if code, _ := agentStatus(id, privateKey, -10*time.Minute, false); code != 401 {
		t.Fatal("expired proof accepted", code)
	}
	if code, _ := agentStatus(id, privateKey, 0, true); code != 401 {
		t.Fatal("modified signed request accepted", code)
	}
	if count(`SELECT count(*) FROM agent_account_deletions WHERE proof_hash=?`, s.agentDeletionHash(fmt.Sprint(id), fingerprint(publicKey))) != 1 {
		t.Fatal("missing minimal deletion proof")
	}
	// Reissue the exact public number through the normal reservation/allocator.
	check(insertProvisionedAgent(db, 807003, "erase-new@identity.invalid", "新账号", now))
	freshHash, e := bcrypt.GenerateFromPassword([]byte("fresh-fixture-password"), bcrypt.MinCost)
	check(e)
	exec(`INSERT INTO owner_uid_numbers(number,source,reserved_agent_id,created_at) VALUES(?,'operator',807003,?)`, number, now)
	check(db.Transaction(func(tx *gorm.DB) error {
		fresh, e := owneruid.AllocateForOwner(tx, 807003, "fresh_owner", now)
		if e != nil {
			return e
		}
		if fresh != number {
			t.Fatal("number not reusable")
		}
		return tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at) VALUES('fresh_owner',?,?,'new-recovery','fixture-phone','8000',?,?)`, fresh, string(freshHash), now, now).Error
	}))
	check(bindManagedAdminNumbers(db))
	if count(`SELECT count(*) FROM managed_admin_bindings WHERE number=? AND owner_uid IS NOT NULL`, number) != 0 {
		t.Fatal("recycled admin UID inherited permission")
	}
	if count(`SELECT count(*) FROM portrait_memories WHERE user_id='fresh_owner'`) != 0 {
		t.Fatal("old memory inherited")
	}
	if _, err = s.authenticateUID(uidRequest{UID: fmt.Sprint(number), Password: password}); err == nil {
		t.Fatal("old password usable")
	}
}

func TestAccountDeletionExternalResult(t *testing.T) {
	for _, body := range []string{`{}`, `{"total":1,"deleted":0,"failures":[]}`, `{"total":1,"deleted":1,"version_conflicts":1}`, `{"total":1,"deleted":1,"timed_out":true}`, `{"total":1,"deleted":1,"failures":[{}]}`} {
		if checkErasureIndexResult(200, strings.NewReader(body)) == nil {
			t.Fatal("partial cleanup accepted", body)
		}
	}
	if checkErasureIndexResult(200, strings.NewReader(`{"total":2,"deleted":2,"version_conflicts":0,"failures":[]}`)) != nil {
		t.Fatal("complete cleanup rejected")
	}
	if checkErasureIndexResult(403, strings.NewReader(`{"total":0,"deleted":0}`)) == nil {
		t.Fatal("read-only response accepted")
	}
	p := accountErasure{Agents: []int64{807001}, Items: []int64{807041}}
	if !erasurePayloadMatches(map[string]any{"payload": `{"agent_id":807001,"content":"private"}`}, p) || erasurePayloadMatches(map[string]any{"agent_id": "807002", "content": "807001"}, p) {
		t.Fatal("queue erasure crossed account boundary")
	}
}
