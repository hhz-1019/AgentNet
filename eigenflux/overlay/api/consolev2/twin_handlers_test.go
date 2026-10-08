package consolev2

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestTwinValidation(t *testing.T) {
	p := twinProfile{Name: "测试用户", CurrentGoal: "找到研究伙伴", Persona: twinPersona{Traits: map[string]float64{"openness": 0.8}}}
	if err := validateTwinProfile(p, true); err != nil {
		t.Fatal(err)
	}
	for _, v := range []float64{-0.1, 1.1, math.NaN(), math.Inf(1)} {
		p.Persona.Traits["openness"] = v
		if validateTwinProfile(p, true) == nil {
			t.Fatal("invalid weight accepted", v)
		}
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
	h.POST("/act", auth, s.twinQuota("posts"), func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"ok": true}) })
	request := func(method, path string, body any) (int, map[string]any) {
		text, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(text)), Len: len(text)}, ut.Header{Key: "Content-Type", Value: "application/json"}).Result()
		var data map[string]any
		_ = json.Unmarshal(r.Body(), &data)
		return r.StatusCode(), data
	}
	p := twinProfile{Name: "私人昵称", CurrentGoal: "找研究伙伴", BasicInfo: map[string]string{"role": "学生"}, Persona: twinPersona{Traits: map[string]float64{"openness": 0.8}}, Episodes: []twinEpisode{{ID: "00000000-0000-4000-8000-000000000001", Content: "私人经历", Importance: 0.7}}, Knowledge: []twinKnowledge{{ID: "00000000-0000-4000-8000-000000000002", Concept: "价值观", Description: "开放合作", Confidence: 0.8}}, Relationships: []twinRelationship{{ID: "00000000-0000-4000-8000-000000000003", TargetID: "导师代号", Intimacy: 0.5, Trust: 0.8}}}
	status, _ := request("PUT", "/twin", map[string]any{"expected_revision": 0, "profile": p})
	if status != 200 {
		t.Fatalf("save: %d", status)
	}
	status, out := request("GET", "/twin", nil)
	if status != 200 {
		t.Fatal(status)
	}
	data := out["data"].(map[string]any)
	rev := data["revision"].(float64)
	saved := data["profile"].(map[string]any)
	if saved["name"] != p.Name || len(saved["episodes"].([]any)) != 1 {
		t.Fatal("read does not match save", saved)
	}
	_, other := request("GET", "/twin?b=1", nil)
	if other["data"].(map[string]any)["profile"].(map[string]any)["name"] == p.Name {
		t.Fatal("owner data leaked")
	}
	status, _ = request("GET", "/twin?handoff=1", nil)
	if status != 403 {
		t.Fatal("handoff read private owner profile", status)
	}
	status, _ = request("PUT", "/twin", map[string]any{"expected_revision": 0, "profile": p})
	if status != 409 {
		t.Fatal("stale revision accepted", status)
	}
	status, _ = request("PUT", "/twin?b=1", map[string]any{"expected_revision": 0, "profile": p})
	if status != 409 {
		t.Fatal("foreign record ID accepted", status)
	}
	p.Episodes = nil
	p.Knowledge = nil
	p.Relationships = nil
	status, _ = request("PUT", "/twin", map[string]any{"expected_revision": rev, "profile": p})
	if status != 200 {
		t.Fatal("record removal failed", status)
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
	status, _ = request("PUT", "/policy", twinPolicy{DailyPosts: 0, Revision: 1})
	if status != 200 {
		t.Fatal("policy update failed", status)
	}
	status, _ = request("POST", "/act", map[string]any{})
	if status != 429 {
		t.Fatal("zero quota accepted activity", status)
	}
	if err := db.Exec(`DELETE FROM twin_daily_usage;DELETE FROM twin_agent_policy;DELETE FROM twin_users;DELETE FROM agent_owners;DELETE FROM console_v2_sessions;DELETE FROM human_accounts;`).Error; err != nil {
		t.Fatal(err)
	}
}
