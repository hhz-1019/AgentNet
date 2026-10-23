package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestManagedOwnerActivitySync(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	now := time.Now().UnixMilli()
	const id int64 = 887201
	const peer int64 = 887202
	check(insertProvisionedAgent(db, id, "owner-events@identity.invalid", "同行", now))
	check(insertProvisionedAgent(db, peer, "owner-events-peer@identity.invalid", "伙伴", now))
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at) VALUES('owner-events',987887201,'x','x','owner-events-phone','8201',?,?); INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(?,'owner-events',?)`, now, now, id, now).Error)
	activityFixtureGrants(t, db, id)
	activityFixtureGrants(t, db, peer)
	s := &Service{db: db, idgen: &managedTestIDs{id: 887210}, publicURL: "https://test.invalid"}
	session, err := s.newUIDSession(db, app.NewContext(0), "owner-events", id, now)
	check(err)
	cookie := consoleSessionCookieName(session.Slot) + "=" + session.ID + "." + session.Secret + "; " + consoleCSRFCookieName(session.Slot) + "=" + session.CSRF
	headers := []ut.Header{{Key: "Cookie", Value: cookie}, {Key: "Origin", Value: "https://test.invalid"}, {Key: "Content-Type", Value: "application/json"}, {Key: "X-CSRF-Token", Value: session.CSRF}}
	h := server.New()
	h.POST("/api/v2/console/social/drafts", s.consoleAuth(true), s.requireCompleted, s.createSocialDraft)
	h.POST("/api/v2/console/social/posts/:post_id/publish", s.consoleAuth(true), s.requireCompleted, s.publishSocialPost)
	h.PUT("/api/v2/console/social/posts/:post_id/reaction", s.consoleAuth(true), s.requireCompleted, s.setSocialReaction)
	h.POST("/api/v2/console/social/posts/:post_id/comments", s.consoleAuth(true), s.requireCompleted, s.createSocialComment)
	h.POST("/api/v2/console/pm/send", s.consoleAuth(true), s.requireCompleted, s.sendHumanPM)
	h.PUT("/api/v2/console/people/:person_id/follow", s.consoleAuth(true), s.requireCompleted, s.putFollow)
	h.DELETE("/api/v2/console/session", s.consoleAuth(true), s.deleteConsoleSession)
	h.GET("/api/v2/console/social/posts", s.consoleAuth(false), s.listSocialPosts)
	call := func(method, path string, body any, want int) map[string]json.RawMessage {
		t.Helper()
		raw, _ := json.Marshal(body)
		w := ut.PerformRequest(h.Engine, method, "https://test.invalid"+path, &ut.Body{Body: strings.NewReader(string(raw)), Len: len(raw)}, headers...)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return activityData(activityResult{Status: w.Code, Data: w.Body.Bytes()})
	}
	tool := func(name string, req activityRequest, want int) activityResult {
		t.Helper()
		r, e := s.activityTool(ctx, id, name, req)
		check(e)
		if r.Status != want {
			t.Fatalf("%s: %d %s", name, r.Status, r.Data)
		}
		return r
	}
	batch := func() ownerActivityBatch {
		t.Helper()
		r := tool("owner_events", activityRequest{}, 200)
		var env struct {
			Data ownerActivityBatch `json:"data"`
		}
		check(json.Unmarshal(r.Data, &env))
		return env.Data
	}
	doc := socialTestDocument()
	doc.Identity = "human"
	draft := call("POST", "/api/v2/console/social/drafts", socialWriteRequest{Document: doc, Visibility: "public", IdempotencyKey: "owner-draft"}, 201)
	post := activityString(draft, "id")
	if post == "" {
		t.Fatal("post receipt missing", draft)
	}
	call("POST", "/api/v2/console/social/posts/"+post+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, 200)
	call("PUT", "/api/v2/console/social/posts/"+post+"/reaction", map[string]any{"kind": "like", "active": true}, 200)
	call("PUT", "/api/v2/console/social/posts/"+post+"/reaction", map[string]any{"kind": "like", "active": false}, 200)
	call("POST", "/api/v2/console/social/posts/"+post+"/comments", map[string]any{"content": "我已经问过到岗时间，请接着核对具体地点。", "idempotency_key": "owner-comment"}, 200)
	first := batch()
	if len(first.Events) != 5 {
		t.Fatalf("human writes not captured: %+v", first)
	}
	if !strings.Contains(string(first.Events[2].Target), `"active":true`) || !strings.Contains(string(first.Events[3].Target), `"active":false`) {
		t.Fatal("cancellation order lost", first)
	}
	// Real Agent calls are not mislabeled as human events.
	tool("react", activityRequest{ID: post, Key: "agent-like", Data: json.RawMessage(`{"kind":"like","active":true}`)}, 200)
	call("GET", "/api/v2/console/social/posts", nil, 200)
	call("PUT", "/api/v2/console/social/posts/"+post+"/reaction", map[string]any{"kind": "invalid", "active": true}, 400)
	if len(batch().Events) != 5 {
		t.Fatal("read/failed/agent request became a human event")
	}
	// The shared plan reaches both platform and external hosts.
	plan := tool("plan", activityRequest{}, 200)
	if !strings.Contains(string(activityData(plan)["owner_actions"]), first.Events[0].ID) {
		t.Fatal("plan omitted owner events")
	}
	call("PUT", "/api/v2/console/people/887202/follow", map[string]any{"following": true}, 200)
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(?,?,1,1),(?,?,1,1) ON CONFLICT DO NOTHING`, id, peer, peer, id).Error)
	call("POST", "/api/v2/console/pm/send", map[string]any{"receiver_id": "887202", "content": "私密内容不允许出现在公开活动上下文里。", "idempotency_key": "owner-message"}, 201)
	raw, _ := json.Marshal(batch())
	if strings.Contains(string(raw), "私密内容") || !strings.Contains(string(raw), "conv_id") {
		t.Fatal("private message journal boundary", string(raw))
	}
	ack := func(ids []string, key string, want int) {
		t.Helper()
		data, _ := json.Marshal(map[string]any{"ids": ids, "summary": "接续主人已做的交流，已取消的点赞保持取消。"})
		tool("ack_owner_events", activityRequest{Key: key, Data: data}, want)
	}
	ids := []string{}
	for _, e := range first.Events {
		ids = append(ids, e.ID)
	}
	ack(ids, "owner-ack", 200)
	ack(ids, "owner-ack", 200)
	if len(batch().RecentResolutions) != 1 {
		t.Fatal("durable continuation missing", batch())
	}
	if len(batch().Events) != 2 {
		t.Fatal("ack swallowed newer writes or failed replay", batch())
	}
	// Cross-account IDs are rejected atomically.
	var foreign int64
	check(db.Raw(`INSERT INTO owner_activity_events(agent_id,action,method,route,status,created_at) VALUES(?,'profile','PUT','/other','applied',?) RETURNING event_id`, peer, now).Scan(&foreign).Error)
	ack([]string{batch().Events[0].ID, fmtRun(foreign)}, "cross-account", 409)
	if len(batch().Events) != 2 {
		t.Fatal("partial ack on invalid batch")
	}
	// A write interrupted after business mutation is read-back work, not success.
	var interrupted int64
	check(db.Raw(`INSERT INTO owner_activity_events(agent_id,action,method,route,created_at) VALUES(?,'content','POST','/interrupted',?) RETURNING event_id`, id, now-180000).Scan(&interrupted).Error)
	pending := batch()
	if pending.Events[len(pending.Events)-1].Status != "uncertain" {
		t.Fatal("uncertain became success")
	}
	// Account-scoped pending events survive ordinary browser logout.
	call("DELETE", "/api/v2/console/session", nil, 200)
	if len(batch().Events) != 3 {
		t.Fatal("logout erased or added social changes")
	}
	// Multiple batches, without a cursor that could skip a late completed event.
	for i := 0; i < 12; i++ {
		check(db.Exec(`INSERT INTO owner_activity_events(agent_id,action,method,route,status,created_at) VALUES(?,'profile','PUT','/profile','applied',?)`, id, now).Error)
	}
	page := batch()
	if len(page.Events) != 10 || !page.HasMore {
		t.Fatal("pagination missing")
	}
	ids = nil
	for _, e := range page.Events {
		ids = append(ids, e.ID)
	}
	ack(ids, "batch-ack", 200)
	if len(batch().Events) != 5 || batch().HasMore {
		t.Fatal("pagination skipped events", batch())
	}
}

func TestManagedOwnerActionClassification(t *testing.T) {
	for _, p := range []string{"/api/v2/console/session", "/api/v2/console/analytics/heartbeat", "/api/v2/console/pm/conversations/:conv_id/read", "/api/v2/console/social/upload", "/api/v2/console/managed/batch", "/api/v2/activity/comment"} {
		if ownerAction("POST", p) != "" {
			t.Fatal("non-business action recorded", p)
		}
	}
	for _, p := range []string{"/api/v2/console/portrait", "/api/v2/console/twin/policy", "/api/v2/console/companion", "/api/v2/agents/me/network-goal", "/api/v2/agents/me/security-boundary", "/api/v2/console/attention-items/:attention_id/respond"} {
		if ownerAction("PUT", p) == "" {
			t.Fatal("important change omitted", p)
		}
		if ownerAction("GET", p) != "" {
			t.Fatal("read recorded", p)
		}
	}
	target := map[string]any{}
	ownerTarget([]byte(`{"content":"secret message","password":"secret","agent_id":"991","conv_id":"9007199254740993","active":false,"kind":"like","state":"arbitrary text"}`), target)
	if len(target) != 3 || target["conv_id"] != "9007199254740993" || target["active"] != false {
		t.Fatal("unsafe or lossy projection", target)
	}
}
