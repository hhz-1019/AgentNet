package consolev2

import (
	"bytes"
	"context"
	coredb "eigenflux_server/pkg/db"
	"eigenflux_server/pkg/es"
	sortdal "eigenflux_server/rpc/sort/dal"
	"encoding/json"
	elasticsearch "github.com/elastic/go-elasticsearch/v8"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func TestAccountErasureSecurityAndIsolation(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	t.Setenv("HUMAN_AUTH_MODE", "uid")
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UnixMilli()
	ids := []int64{991101, 991102, 991103}
	for _, id := range ids {
		check(insertProvisionedAgent(db, id, "erasure-"+decimalIDs([]int64{id})[0]+"@identity.invalid", "删除测试", now))
	}
	password := "delete-test-password-only"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	check(err)
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at) VALUES('erase-owner',777110001,?,'recovery','erase-phone','1234',?,?),('erase-neighbor',777110002,?,'recovery',NULL,NULL,NULL,?)`, string(hash), now, now, string(hash), now).Error)
	check(db.Exec(`INSERT INTO agent_owners VALUES(991101,'erase-owner',?),(991102,'erase-owner',?),(991103,'erase-neighbor',?)`, now, now, now).Error)
	check(ensureTwinUser(db, "erase-owner", now))
	check(ensureTwinUser(db, "erase-neighbor", now))
	check(db.Exec(`INSERT INTO portrait_memories(user_id,memory_id,content,created_at,updated_at) VALUES('erase-owner','a1111111-1111-4111-8111-111111111111','private memory',?,?)`, now, now).Error)
	check(db.Exec(`INSERT INTO raw_items(item_id,author_agent_id,raw_content,created_at) VALUES(991201,991101,'private raw',?),(991202,991103,'neighbor raw',?)`, now, now).Error)
	check(db.Exec(`INSERT INTO processed_items(item_id,summary,updated_at) VALUES(991201,'private summary',?),(991202,'neighbor summary',?)`, now, now).Error)
	check(db.Exec(`UPDATE processed_items SET duplicate_of_item_id=991201 WHERE item_id=991202`).Error)
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at) VALUES(991301,991101,'draft','private','{"title":"private draft"}',?),(991302,991103,'draft','private','{"title":"neighbor draft"}',?)`, now, now).Error)
	check(db.Exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at) VALUES(991303,991301,991103,'reply','erase-comment',?)`, now).Error)
	check(db.Exec(`INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,updated_at) VALUES(991401,991101,991103,991101,991103,?)`, now).Error)
	check(db.Exec(`INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(991501,991401,991101,991103,'sent',?),(991502,991401,991103,991101,'received',?)`, now, now).Error)
	check(db.Exec(`INSERT INTO agent_avatars(avatar_id,agent_id,content,created_at) VALUES('erase-avatar',991101,?,?)`, []byte("image"), now).Error)
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(991101,991103,1,?)`, now).Error)
	redisServer := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer client.Close()
	s := &Service{db: db, redisClient: client, otpPepper: "erase-test-pepper", publicURL: "https://test.invalid"}
	var login uidSession
	check(db.Transaction(func(tx *gorm.DB) error {
		var e error
		login, e = s.newUIDSession(tx, app.NewContext(0), "erase-owner", 991101, now)
		return e
	}))
	// Multiple-device credentials must all be removed, not just the current slot.
	check(db.Transaction(func(tx *gorm.DB) error {
		_, e := s.newUIDSession(tx, app.NewContext(0), "erase-owner", 991102, now)
		return e
	}))
	h := server.New()
	h.GET("/api/v2/console/account", s.consoleAuth(false), s.getAccountErasure)
	h.DELETE("/api/v2/console/account", s.consoleAuth(true), s.deleteAccount)
	call := func(method string, body erasureRequest, csrf, origin string) (int, map[string]any) {
		t.Helper()
		b, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, "https://test.invalid/api/v2/console/account", &ut.Body{Body: bytes.NewReader(b), Len: len(b)}, ut.Header{Key: "Host", Value: "test.invalid"}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Cookie", Value: consoleCookieName + "=" + login.ID + "." + login.Secret}, ut.Header{Key: "Origin", Value: origin}, ut.Header{Key: "X-CSRF-Token", Value: csrf}).Result()
		var out map[string]any
		check(json.Unmarshal(r.Body(), &out))
		return r.StatusCode(), out
	}
	valid := erasureRequest{Account: "777110001", Password: password, Confirm: true}
	status, out := call("GET", erasureRequest{}, "", "")
	if status != 200 {
		t.Fatal(status, out)
	}
	data := out["data"].(map[string]any)
	if data["agents"] != float64(2) || data["messages"] != float64(2) {
		t.Fatal(out)
	}
	for _, bad := range []struct {
		req          erasureRequest
		csrf, origin string
	}{
		{valid, "", "https://test.invalid"}, {valid, login.CSRF, "https://other.invalid"},
		{erasureRequest{Account: "777110002", Password: password, Confirm: true}, login.CSRF, "https://test.invalid"},
		{erasureRequest{Account: "777110001", Password: "incorrect", Confirm: true}, login.CSRF, "https://test.invalid"},
		{erasureRequest{Account: "777110001", Password: password, Confirm: false}, login.CSRF, "https://test.invalid"},
	} {
		status, out = call("DELETE", bad.req, bad.csrf, bad.origin)
		if status < 400 {
			t.Fatal("unsafe delete accepted", out)
		}
	}
	check(db.Exec(`UPDATE console_v2_sessions SET auth_method='handoff' WHERE session_id=?`, login.ID).Error)
	status, _ = call("DELETE", valid, login.CSRF, "https://test.invalid")
	if status < 400 {
		t.Fatal("runtime could delete owner")
	}
	check(db.Exec(`UPDATE console_v2_sessions SET auth_method='uid_password' WHERE session_id=?`, login.ID).Error)
	check(db.Exec(`INSERT INTO social_groups(group_id,name,creator_id,created_at,updated_at) VALUES(991601,'group',991101,?,?)`, now, now).Error)
	status, out = call("DELETE", valid, login.CSRF, "https://test.invalid")
	if status != 409 {
		t.Fatal("group ownership not blocked", status, out)
	}
	check(db.Exec(`DELETE FROM social_groups WHERE group_id=991601`).Error)
	// Any purge failure rolls back earlier deletions and leaves the account usable.
	check(db.Exec(`CREATE FUNCTION fail_erasure_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.item_id=991201 THEN RAISE EXCEPTION 'fixture rollback'; END IF;RETURN OLD; END $$`).Error)
	check(db.Exec(`CREATE TRIGGER fail_erasure_fixture BEFORE DELETE ON raw_items FOR EACH ROW EXECUTE FUNCTION fail_erasure_fixture()`).Error)
	status, out = call("DELETE", valid, login.CSRF, "https://test.invalid")
	if status != 503 {
		t.Fatal(status, out)
	}
	var n int64
	check(db.Raw(`SELECT count(*) FROM human_accounts WHERE uid='erase-owner'`).Scan(&n).Error)
	if n != 1 {
		t.Fatal("failed purge removed account")
	}
	check(db.Raw(`SELECT count(*) FROM private_messages WHERE conv_id=991401`).Scan(&n).Error)
	if n != 2 {
		t.Fatal("rollback lost messages")
	}
	check(db.Exec(`DROP TRIGGER fail_erasure_fixture ON raw_items;DROP FUNCTION fail_erasure_fixture()`).Error)
	status, out = call("DELETE", valid, login.CSRF, "https://test.invalid")
	if status != 200 {
		t.Fatal(status, out)
	}
	for _, query := range []string{
		`SELECT count(*) FROM human_accounts WHERE uid='erase-owner'`,
		`SELECT count(*) FROM agents WHERE agent_id IN (991101,991102)`,
		`SELECT count(*) FROM agent_principals WHERE agent_id IN (991101,991102)`,
		`SELECT count(*) FROM console_v2_sessions WHERE owner_uid='erase-owner'`,
		`SELECT count(*) FROM portrait_memories WHERE user_id='erase-owner'`,
		`SELECT count(*) FROM raw_items WHERE item_id=991201`,
		`SELECT count(*) FROM processed_items WHERE item_id=991201`,
		`SELECT count(*) FROM private_messages WHERE conv_id=991401`,
		`SELECT count(*) FROM conversations WHERE conv_id=991401`,
		`SELECT count(*) FROM social_work_comments WHERE post_id=991301`,
		`SELECT count(*) FROM agent_avatars WHERE avatar_id='erase-avatar'`,
		`SELECT count(*) FROM user_relations WHERE from_uid=991101 OR to_uid=991101`,
	} {
		check(db.Raw(query).Scan(&n).Error)
		if n != 0 {
			t.Fatalf("retained data: %s = %d", query, n)
		}
	}
	for _, query := range []string{`SELECT count(*) FROM agents WHERE agent_id=991103`, `SELECT count(*) FROM human_accounts WHERE uid='erase-neighbor'`, `SELECT count(*) FROM social_work_posts WHERE post_id=991302`, `SELECT count(*) FROM processed_items WHERE item_id=991202 AND duplicate_of_item_id IS NULL`} {
		check(db.Raw(query).Scan(&n).Error)
		if n != 1 {
			t.Fatalf("neighbor damaged: %s", query)
		}
	}
	check(db.Raw(`SELECT count(*) FROM account_erasure_jobs WHERE completed_at IS NULL`).Scan(&n).Error)
	if n != 1 {
		t.Fatal("missing cleanup job")
	}
	check(db.Raw(`SELECT count(*) FROM owner_uid_numbers WHERE number=777110001 AND registered AND owner_uid='deleted:777110001' AND reserved_agent_id IS NULL`).Scan(&n).Error)
	if n != 1 {
		t.Fatal("number recycled or owner retained")
	}
	status, _ = call("GET", erasureRequest{}, "", "")
	if status != 401 {
		t.Fatal("old login survived", status)
	}
	// Re-registration can use the same phone, but never resurrect the old number.
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at) VALUES('erase-new',777110003,?,'recovery','erase-phone','1234',?,?)`, string(hash), now, now).Error)
	if err = db.Exec(`INSERT INTO processed_items(item_id,updated_at) VALUES(991201,1)`).Error; err == nil {
		t.Fatal("queue resurrected erased item")
	}
	if err = db.Exec(`INSERT INTO agent_profiles(agent_id,updated_at) VALUES(991101,1)`).Error; err == nil {
		t.Fatal("profile projection resurrected erased agent")
	}
	if err = db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('recycled',777110001,'hash','hash',1)`).Error; err == nil {
		t.Fatal("number reused")
	}
	// Maintenance preview is read-only and uses the same isolation checks.
	report, e := EraseAccountMaintenance(context.Background(), db, 777110002, 0, false)
	check(e)
	if report.Applied || report.Account != "777110002" || len(report.AgentIDs) != 1 {
		t.Fatal("maintenance preview", report)
	}
	if _, e = EraseAccountMaintenance(context.Background(), db, 0, 991103, true); e == nil {
		t.Fatal("maintenance bypassed account ownership")
	}
	check(insertProvisionedAgent(db, 991104, "erase-unbound@identity.invalid", "unbound", now))
	report, e = EraseAccountMaintenance(context.Background(), db, 0, 991104, true)
	check(e)
	if !report.Applied {
		t.Fatal("unbound Agent not removed")
	}
	check(db.Raw("SELECT count(*) FROM agents WHERE agent_id=991104").Scan(&n).Error)
	if n != 0 {
		t.Fatal("unbound Agent survived")
	}
	// Keep external verification focused on the primary job.
	check(db.Exec("DELETE FROM account_erasure_jobs WHERE agent_ids=ARRAY[991104]::bigint[]").Error)
	// External outage remains retryable rather than reporting completed cleanup.
	check(s.cleanErasureJobs(context.Background()))
	check(db.Raw(`SELECT count(*) FROM account_erasure_jobs WHERE completed_at IS NULL AND attempts=1`).Scan(&n).Error)
	if n != 1 {
		t.Fatal("cleanup failure dropped job")
	}

	// Exercise real ES request construction, retries and cache invalidation.
	var calls int
	failed := true
	search := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("X-Elastic-Product", "Elasticsearch")
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "_delete_by_query") {
			raw, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(raw), "991101") || !strings.Contains(string(raw), "991201") {
				t.Error("cleanup lost identity IDs", string(raw))
			}
			if failed {
				_, _ = w.Write([]byte(`{"timed_out":true}`))
				return
			}
			_, _ = w.Write([]byte(`{"timed_out":false,"version_conflicts":0,"failures":[]}`))
		} else {
			_, _ = w.Write([]byte(`{"result":"created"}`))
		}
	}))
	defer search.Close()
	oldES, oldDB := es.Client, coredb.DB
	defer func() { es.Client = oldES; coredb.DB = oldDB }()
	es.Client, err = elasticsearch.NewClient(elasticsearch.Config{Addresses: []string{search.URL}, DisableRetry: true})
	check(err)
	coredb.DB = db
	if e := sortdal.IndexItem(context.Background(), &sortdal.Item{ID: 991201, AuthorAgentID: 991101}); e == nil {
		t.Fatal("deleted content reached index")
	}
	if calls != 0 {
		t.Fatal("deleted content sent to ES")
	}
	check(sortdal.IndexItem(context.Background(), &sortdal.Item{ID: 991202, AuthorAgentID: 991103}))
	// Exercise the API process configuration, which has no global ES client.
	es.Client = nil
	t.Setenv("ES_URL", search.URL)
	check(client.Set(context.Background(), "cache:profile:991101", "secret", 0).Err())
	check(client.Set(context.Background(), "cache:profile:991103", "neighbor", 0).Err())
	check(client.Set(context.Background(), "pm:conv:991401", "private message", 0).Err())
	check(client.Set(context.Background(), "cache:search:fixture:991103:1", "old result", 0).Err())
	check(client.HSet(context.Background(), "agentcard:last_active", "991101", "old", "991103", "neighbor").Err())
	check(db.Exec("UPDATE account_erasure_jobs SET next_attempt_at=0,created_at=created_at-90000000").Error)
	check(s.cleanErasureJobs(context.Background()))
	check(db.Raw("SELECT count(*) FROM account_erasure_jobs WHERE completed_at IS NULL AND attempts=2").Scan(&n).Error)
	if n != 1 {
		t.Fatal("partial ES deletion was completed")
	}
	failed = false
	check(db.Exec("UPDATE account_erasure_jobs SET next_attempt_at=0").Error)
	check(s.cleanErasureJobs(context.Background()))
	check(db.Raw("SELECT count(*) FROM account_erasure_jobs WHERE completed_at IS NOT NULL AND attempts=3").Scan(&n).Error)
	if n != 1 {
		t.Fatal("successful cleanup remained pending")
	}
	for _, key := range []string{"cache:profile:991101", "pm:conv:991401", "cache:search:fixture:991103:1"} {
		if client.Exists(context.Background(), key).Val() != 0 {
			t.Fatal("cache survived", key)
		}
	}
	if client.Get(context.Background(), "cache:profile:991103").Val() != "neighbor" || client.HGet(context.Background(), "agentcard:last_active", "991103").Val() != "neighbor" {
		t.Fatal("unrelated cache removed")
	}
	if client.HExists(context.Background(), "agentcard:last_active", "991101").Val() {
		t.Fatal("hash projection survived")
	}
	if strings.Contains(string(hash), password) {
		t.Fatal("fixture invalid")
	}
}
