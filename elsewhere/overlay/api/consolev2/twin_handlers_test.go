package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestTwinValidation(t *testing.T) {
	p := twinProfile{Name: "测试用户", CurrentGoal: "找到研究伙伴", Persona: twinPersona{}}
	if err := validateTwinProfile(p, true); err != nil {
		t.Fatal(err)
	}
	p.Episodes = []twinEpisode{{Content: "不能上传的经历"}}
	if validateTwinProfile(p, true) == nil {
		t.Fatal("memory upload accepted")
	}
	if validTwinPolicy(twinPolicy{DailyPosts: -1}) || validTwinPolicy(twinPolicy{DailySearches: 1001}) {
		t.Fatal("invalid quota accepted")
	}
}
func TestTwinOwnerIsolationAndQuotas(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	if err := db.Exec(`INSERT INTO human_accounts(uid,password_hash,recovery_hash,created_at) VALUES('twin-a','fixture','fixture',1),('twin-b','fixture','fixture',1) ON CONFLICT DO NOTHING;
 INSERT INTO agent_owners VALUES(1,'twin-a',1),(2,'twin-b',1) ON CONFLICT DO NOTHING;
 INSERT INTO console_v2_sessions(session_id,owner_uid,auth_method,status) VALUES('twin-session-a','twin-a','uid_password','active'),('twin-session-b','twin-b','uid_password','active') ON CONFLICT DO NOTHING;`).Error; err != nil {
		t.Fatal(err)
	}
	s := &Service{db: db}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		id := int64(1)
		session := "twin-session-a"
		if c.Query("b") == "1" {
			id = 2
			session = "twin-session-b"
		}
		if c.Query("handoff") == "1" {
			session = "unverified-handoff"
		}
		c.Set("agent_id", id)
		c.Set("console_session_id", session)
		c.Next(ctx)
	}
	h.GET("/twin", auth, s.getTwin)
	h.PUT("/twin", auth, s.putTwin)
	h.PUT("/policy", auth, s.putTwinPolicy)
	h.GET("/policy", auth, s.getTwinPolicy)
	h.POST("/act", auth, s.twinQuota("posts"), func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"ok": true}) })
	request := func(method, path string, body any) (int, map[string]any) {
		text, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(text)), Len: len(text)}, ut.Header{Key: "Content-Type", Value: "application/json"}).Result()
		var data map[string]any
		_ = json.Unmarshal(r.Body(), &data)
		return r.StatusCode(), data
	}
	p := twinProfile{Name: "私人昵称", Episodes: []twinEpisode{{Content: "私人经历"}}}
	status, _ := request("PUT", "/twin", map[string]any{"expected_revision": 0, "profile": p})
	if status != 410 {
		t.Fatal("legacy writes must retire", status)
	}
	status, out := request("GET", "/twin", nil)
	if status != 200 {
		t.Fatal(status)
	}
	data := out["data"].(map[string]any)
	if len(data["memories"].([]any)) != 0 || data["memory_mode"] != "host" {
		t.Fatal("legacy read leaked memory", data)
	}
	status, _ = request("GET", "/twin?handoff=1", nil)
	if status != 403 {
		t.Fatal("unverified owner read", status)
	}
	status, out = request("GET", "/policy", nil)
	if status != 200 || out["data"].(map[string]any)["daily_feedback"] != float64(40) {
		t.Fatal("new companion default must allow active exchanges", status, out)
	}
	status, _ = request("PUT", "/policy", twinPolicy{DailyPosts: 3, DailySearches: 4, DailyFeedback: 2})
	if status != 200 {
		t.Fatal(status)
	}
	status, _ = request("PUT", "/policy", twinPolicy{DailyPosts: 99})
	if status != 409 {
		t.Fatal("stale policy accepted", status)
	}
	var mu sync.Mutex
	accepted := 0
	limited := 0
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, _ := request("POST", "/act", map[string]any{})
			mu.Lock()
			defer mu.Unlock()
			if status == 200 {
				accepted++
			} else if status == 429 {
				limited++
			} else {
				t.Errorf("quota status %d", status)
			}
		}()
	}
	wg.Wait()
	if accepted != 3 || limited != 9 {
		t.Fatalf("atomic quota: accepted %d limited %d", accepted, limited)
	}
	status, out = request("GET", "/policy", nil)
	if status != 200 {
		t.Fatal("policy progress read failed", status, out)
	}
	policy := out["data"].(map[string]any)
	progress := policy["publishing_progress"].(map[string]any)
	if progress["minimum"] != float64(5) || progress["quota_used"] != float64(3) || progress["limit_below_minimum"] != true {
		t.Fatal("missing authoritative progress", progress)
	}
	// Existing clients send their whole GET response back on save. Derived
	// counts are accepted for compatibility but cannot be set by that request.
	policy["daily_posts"] = 0
	progress["published"] = 999
	status, _ = request("PUT", "/policy", policy)
	if status != 200 {
		t.Fatal("policy update failed", status)
	}
	status, out = request("GET", "/policy", nil)
	if status != 200 || out["data"].(map[string]any)["publishing_progress"].(map[string]any)["published"] == float64(999) {
		t.Fatal("client forged publication progress", status, out)
	}
	status, _ = request("POST", "/act", map[string]any{})
	if status != 429 {
		t.Fatal("zero quota accepted activity", status)
	}
	if err := db.Exec(`DELETE FROM twin_daily_usage;DELETE FROM twin_agent_policy;DELETE FROM twin_users;DELETE FROM agent_owners;DELETE FROM console_v2_sessions;DELETE FROM legacy_profile_archives;DELETE FROM human_accounts;`).Error; err != nil {
		t.Fatal(err)
	}
}
