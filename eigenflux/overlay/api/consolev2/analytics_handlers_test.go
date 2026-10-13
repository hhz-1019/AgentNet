package consolev2

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestAnalyticsFullSchema(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	exec := func(sql string, args ...any) { t.Helper(); check(db.Exec(sql, args...).Error) }
	now := time.Now()
	ms := now.UnixMilli()
	zone := time.FixedZone("CST", 8*3600)
	today := now.In(zone).Format("2006-01-02")
	day := func(ago int) string { return now.In(zone).AddDate(0, 0, -ago).Format("2006-01-02") }
	stamp := func(ago int) int64 { return now.AddDate(0, 0, -ago).UnixMilli() }
	exec(`UPDATE analytics_collection SET started_at=?`, stamp(40))
	for i, uid := range []string{"analytics-admin", "analytics-a", "analytics-b", "analytics-empty", "analytics-ai"} {
		at := ms
		if i == 1 || i == 2 {
			at = stamp(10)
		}
		exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'test','test',?)`, uid, 20001+i, at)
		id := int64(7001 + i)
		check(insertProvisionedAgent(db, id, uid+"@test.invalid", uid, at))
		exec(`INSERT INTO agent_owners VALUES(?,?,?)`, id, uid, at)
		exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,active_context_revision,created_at,updated_at,completed_at) VALUES(?,'completed',5,1,1,?,?,?)`, id, at, at, at)
		if i == 1 || i == 2 || i == 4 {
			exec(`INSERT INTO agent_principals(agent_id,key_type,key_fingerprint,public_key,status,created_at,last_seen_at) VALUES(?,'ed25519-v1',?,decode(repeat('22',32),'hex'),'active',?,?)`, id, uid, at, at)
		}
	}
	exec(`INSERT INTO managed_campaigns(sponsor_uid) VALUES('analytics-admin')`)
	exec(`INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona) VALUES(7005,'analytics-ai','analytics-admin',0,'AI','test','test')`)
	exec(`INSERT INTO analytics_owner_days VALUES('analytics-a',?::date,?),('analytics-b',?::date,?),('analytics-a',?::date,?),('analytics-ai',?::date,?)`, today, ms, today, ms-121000, day(3), stamp(3), today, ms)
	// A published post is counted once, never on edits or draft saves.
	exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at) VALUES(8101,7002,'draft','public','{}',?)`, ms)
	exec(`UPDATE social_work_posts SET state='published',approved_revision=revision,published_at=? WHERE post_id=8101`, ms)
	exec(`UPDATE social_work_posts SET document='{"body":"edit"}' WHERE post_id=8101`)
	exec(`INSERT INTO social_work_reactions VALUES(8101,7003,'like')`)
	exec(`DELETE FROM social_work_reactions WHERE post_id=8101`)
	exec(`INSERT INTO social_work_reactions VALUES(8101,7003,'like')`)
	exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision) VALUES(8102,7005,'published','public','{}',?,?,1)`, ms, ms)
	exec(`INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,updated_at) VALUES(8201,7002,7003,7002,7003,?),(8202,7002,7003,7002,7003,?)`, ms, ms)
	exec(`INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(8301,8201,7002,7003,'private',?),(8302,8202,7003,7002,'private',?),(8303,8201,7002,7003,'private',?)`, ms, ms, ms)
	now = time.Now() // Trigger timestamps are assigned at insertion, after fixture start.
	data, err := analyticsSnapshot(db, now, 7)
	check(err)
	metrics := data["metrics"].(map[string]any)
	want := map[string]float64{"users": 4, "new_users": 2, "agents": 2, "connected_users": 2, "active_agents": 2, "connections": 1, "dau": 2, "online": 1, "retention_eligible": 2, "retention_returned": 1, "managed_accounts": 1, "managed_active_today": 1}
	for key, value := range want {
		if metrics[key] != value {
			t.Fatalf("%s=%v, want %v", key, metrics[key], value)
		}
	}
	if len(data["trend"].([]any)) != 7 || len(data["retention"].([]any)) != 7 {
		t.Fatal("range length")
	}
	for _, v := range data["features"].([]any) {
		f := v.(map[string]any)
		if f["key"] == "publish" && f["events"] != float64(1) {
			t.Fatal("edit/AI inflated count", f)
		}
		if f["key"] == "like" && f["events"] != float64(1) {
			t.Fatal("reaction repeated", f)
		}
	}
	// Newly deployed collection must not manufacture historical zeroes/retention.
	exec(`UPDATE analytics_collection SET started_at=?`, ms)
	missing, err := analyticsSnapshot(db, now, 30)
	check(err)
	if missing["metrics"].(map[string]any)["retention_eligible"] != nil || missing["trend"].([]any)[0].(map[string]any)["dau"] != nil {
		t.Fatal("unobserved history treated as zero")
	}
	// Beijing midnight changes daily buckets while a recent prior-day heartbeat remains online.
	midnight, err := time.ParseInLocation("2006-01-02", today, zone)
	check(err)
	exec(`DELETE FROM analytics_owner_days`)
	exec(`INSERT INTO analytics_owner_days VALUES('analytics-a',?::date,?)`, day(1), midnight.UnixMilli()-30000)
	boundary, err := analyticsSnapshot(db, midnight.Add(30*time.Second), 7)
	check(err)
	bm := boundary["metrics"].(map[string]any)
	if bm["online"] != float64(1) || bm["dau"] != float64(0) {
		t.Fatal("midnight online/DAU", bm)
	}
	// Real authentication middleware, CSRF and session-derived heartbeat identity.
	s := &Service{db: db, otpPepper: "analytics-test", publicURL: "https://test.invalid"}
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "20001")
	makeSession := func(owner string, id int64) uidSession {
		t.Helper()
		ss, e := s.newUIDSession(db, app.NewContext(0), owner, id, ms)
		check(e)
		return ss
	}
	admin := makeSession("analytics-admin", 7001)
	member := makeSession("analytics-a", 7002)
	ai := makeSession("analytics-ai", 7005)
	h := server.New()
	h.GET("/analytics", s.consoleAuth(false), s.getAnalytics)
	h.GET("/members", s.consoleAuth(false), s.getAdminMembers)
	h.POST("/heartbeat", s.consoleAuth(true), s.analyticsHeartbeat)
	call := func(method, path, body string, ss *uidSession, csrf bool, want int) []byte {
		t.Helper()
		headers := []ut.Header{{Key: "Host", Value: "test.invalid"}, {Key: "Origin", Value: "https://test.invalid"}, {Key: "Content-Type", Value: "application/json"}}
		if ss != nil {
			headers = append(headers, ut.Header{Key: "Cookie", Value: fmt.Sprintf("ef_console_v2=%s.%s", ss.ID, ss.Secret)})
			if csrf {
				headers = append(headers, ut.Header{Key: "X-CSRF-Token", Value: ss.CSRF})
			}
		}
		r := ut.PerformRequest(h.Engine, method, "https://test.invalid"+path, &ut.Body{Body: bytes.NewBufferString(body), Len: len(body)}, headers...).Result()
		if r.StatusCode() != want {
			t.Fatalf("%s %s: %d %s", method, path, r.StatusCode(), r.Body())
		}
		return r.Body()
	}
	call("GET", "/analytics", "", nil, false, 401)
	call("GET", "/analytics", "", &member, false, 403)
	call("GET", "/members", "", nil, false, 401)
	call("GET", "/members", "", &member, false, 403)
	call("GET", "/members?status=invalid", "", &admin, false, 400)
	call("GET", "/members?page=0", "", &admin, false, 400)
	for _, item := range []struct {
		query string
		total float64
	}{{"", 4}, {"?q=20002", 1}, {"?status=connected", 2}, {"?status=unconnected", 2}, {"?q=%25", 0}} {
		var response struct {
			Data struct {
				Total   float64
				Members []map[string]any
			}
		}
		body := call("GET", "/members"+item.query, "", &admin, false, 200)
		check(json.Unmarshal(body, &response))
		if response.Data.Total != item.total {
			t.Fatalf("member filter %s: %s", item.query, body)
		}
		if strings.Contains(string(body), "password") || strings.Contains(string(body), "recovery") || strings.Contains(string(body), "analytics-ai") {
			t.Fatal("members leaked protected fields or managed AI")
		}
	}
	for i := 0; i < 26; i++ {
		exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'x','x',?)`, fmt.Sprintf("page-%d", i), 21000+i, ms)
	}
	var paged struct {
		Data struct {
			Total   int
			Members []any
		}
	}
	check(json.Unmarshal(call("GET", "/members?page=2", "", &admin, false, 200), &paged))
	if paged.Data.Total != 30 || len(paged.Data.Members) != 5 {
		t.Fatal("member pagination", paged)
	}
	call("GET", "/analytics?days=365", "", &admin, false, 400)
	raw := call("GET", "/analytics?days=14", "", &admin, false, 200)
	if strings.Contains(string(raw), "password") || strings.Contains(string(raw), "private") || strings.Contains(string(raw), "analytics-a") {
		t.Fatal("sensitive data in aggregates")
	}
	var decoded map[string]any
	check(json.Unmarshal(raw, &decoded))
	call("POST", "/heartbeat", "{}", &member, false, 403)
	call("POST", "/heartbeat", `{"owner_uid":"analytics-empty","created_at":1}`, &member, true, 200)
	call("POST", "/heartbeat", "{}", &member, true, 200)
	call("POST", "/heartbeat", "{}", &ai, true, 200)
	var count int64
	check(db.Raw(`SELECT count(*) FROM analytics_owner_days WHERE day=?::date`, today).Scan(&count).Error)
	if count != 1 {
		t.Fatal("heartbeat not deduplicated or AI included", count)
	}
	var owner string
	check(db.Raw(`SELECT owner_uid FROM analytics_owner_days WHERE day=?::date`, today).Scan(&owner).Error)
	if owner != "analytics-a" {
		t.Fatal("spoofed owner", owner)
	}
}
