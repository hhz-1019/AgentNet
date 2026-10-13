package consolev2

import (
	"context"
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

func TestNetworkEvidenceDecisionsAndCadence(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" || os.Getenv("AGENTNET_NETWORK_TEST") != "1" {
		t.Skip("run network core test with isolated PostgreSQL")
	}
	db := socialFixtureDB(t, dsn)
	// This suite runs independently of the legacy social fixtures.
	if e := db.Exec(`ALTER TABLE user_relations ADD COLUMN id BIGSERIAL, ADD COLUMN remark TEXT NOT NULL DEFAULT '', ADD COLUMN created_at BIGINT NOT NULL DEFAULT 1;
 ALTER TABLE user_relations ADD CONSTRAINT network_rel_unique UNIQUE(from_uid,to_uid,rel_type);
 CREATE TABLE friend_requests(id BIGINT PRIMARY KEY,from_uid BIGINT,to_uid BIGINT,status SMALLINT DEFAULT 0,greeting TEXT DEFAULT '',remark TEXT DEFAULT '',created_at BIGINT,updated_at BIGINT);
 CREATE TABLE raw_items(item_id BIGINT PRIMARY KEY,author_agent_id BIGINT,raw_content TEXT,created_at BIGINT);
 CREATE TABLE processed_items(item_id BIGINT PRIMARY KEY,status SMALLINT);
 CREATE TABLE agent_feed_exposures(agent_id BIGINT,source_type TEXT,source_id BIGINT,content_class TEXT,author_agent_id BIGINT);
 CREATE TABLE agent_attention_items(attention_id BIGINT PRIMARY KEY,agent_id BIGINT,producer TEXT DEFAULT 'agent',protocol_version TEXT DEFAULT 'agent_attention.v1',source_type TEXT,source_id BIGINT,surface TEXT,status TEXT DEFAULT 'open',expires_at BIGINT,title TEXT,body TEXT,created_at BIGINT,item_revision BIGINT DEFAULT 1,actions_snapshot JSONB DEFAULT '[]',recommendation TEXT DEFAULT '');
 INSERT INTO agents(agent_id,agent_name,bio) VALUES(701,'我的 Agent',''),(702,'已遇见',''),(703,'陌生人',''),(704,'被屏蔽',''),(705,'请求方',''),(706,'已停用','');
 UPDATE agents SET identity_state='inactive' WHERE agent_id=706;
 INSERT INTO user_relations(from_uid,to_uid,rel_type) VALUES(701,702,1),(702,701,1),(701,704,2),(701,706,1);
 INSERT INTO raw_items VALUES(710,702,'只有这一条已被探索',1),(711,702,'同一个作者的未见内容',2),(712,703,'陌生人的内容',3),(713,704,'屏蔽内容',4);
 INSERT INTO processed_items VALUES(710,3),(711,3),(712,3),(713,3);
 INSERT INTO agent_feed_exposures VALUES(701,'broadcast',710,'ugc',702),(703,'broadcast',712,'ugc',703),(701,'broadcast',713,'ugc',704);
 INSERT INTO friend_requests VALUES(720,705,701,0,'合作申请','',10,10),(721,705,703,0,'另一位主人的申请','',10,10);
 INSERT INTO human_accounts VALUES('network-owner','x','x',1);
 INSERT INTO agent_owners VALUES(701,'network-owner',1);
 INSERT INTO console_v2_sessions VALUES('network-session','network-owner','uid_password','active');`).Error; e != nil {
		t.Fatal(e)
	}
	s := &Service{db: db}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		id := int64(701)
		if c.Query("other") == "1" {
			id = 703
		}
		c.Set("agent_id", id)
		c.Set("console_session_id", "network-session")
		c.Next(ctx)
	}
	h.GET("/network", auth, s.getNetwork)
	h.GET("/nodes/:peer_id/events", auth, s.getNetworkEvents)
	h.POST("/read", auth, s.readNetworkEvent)
	h.POST("/requests/:request_id", auth, s.decideNetworkRequest)
	h.GET("/policy", auth, s.getTwinPolicy)
	h.PUT("/policy", auth, s.putTwinPolicy)
	h.POST("/explore", auth, s.twinQuota("searches"), func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"ok": true}) })
	call := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		b, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(b)), Len: len(b)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, r.Code, want, r.Body.String())
		}
		var result map[string]any
		if e := json.Unmarshal(r.Body.Bytes(), &result); e != nil {
			t.Fatal(e)
		}
		data, _ := result["data"].(map[string]any)
		return data
	}
	out := call("GET", "/network", nil, 200)
	raw, _ := json.Marshal(out)
	for _, bad := range []string{"陌生人", "被屏蔽", "已停用", "未见内容"} {
		if strings.Contains(string(raw), bad) {
			t.Fatalf("leaked %s: %s", bad, raw)
		}
	}
	if out["total"] != float64(3) || out["pending"] != float64(1) {
		t.Fatalf("wrong graph totals %s", raw)
	}
	events := call("GET", "/nodes/702/events", nil, 200)["items"].([]any)
	if len(events) != 1 || events[0].(map[string]any)["body"] != "只有这一条已被探索" {
		t.Fatal("wrong exposure scope", events)
	}
	if len(call("GET", "/nodes/702/events?other=1", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("cross-owner exposure leak")
	}
	call("POST", "/read", map[string]any{"event_key": "broadcast:711"}, 404)
	call("POST", "/read", map[string]any{"event_key": "request:720"}, 404)
	call("POST", "/read", map[string]any{"event_key": "broadcast:710"}, 200)
	call("POST", "/read", map[string]any{"event_key": "broadcast:710"}, 200)
	call("POST", "/requests/721", map[string]any{"decision": "accept"}, 404)
	call("POST", "/requests/720", map[string]any{"decision": "accept"}, 200)
	call("POST", "/requests/720", map[string]any{"decision": "accept"}, 200)
	call("POST", "/requests/720", map[string]any{"decision": "reject"}, 409)
	var friends int64
	db.Raw(`SELECT COUNT(*) FROM user_relations WHERE rel_type=1 AND ((from_uid=701 AND to_uid=705) OR (from_uid=705 AND to_uid=701))`).Scan(&friends)
	if friends != 2 {
		t.Fatal("friendship not symmetric", friends)
	}
	explore, report := 60, 24
	p := twinPolicy{DailyPosts: 3, DailySearches: 5, DailyFeedback: 10, ExploreIntervalMinutes: &explore, ReportIntervalHours: &report}
	call("PUT", "/policy", p, 200)
	call("PUT", "/policy", p, 409)
	got := call("GET", "/policy", nil, 200)
	if got["explore_interval_minutes"] != float64(60) || got["report_interval_hours"] != float64(24) {
		t.Fatal("cadence not saved", got)
	}
	call("POST", "/explore", nil, 200)
	call("POST", "/explore", nil, 429)
	p.Revision = 1
	explore = 0
	call("PUT", "/policy", p, 200)
	call("POST", "/explore", nil, 429)
	var used int
	db.Raw(`SELECT used FROM twin_daily_usage WHERE agent_id=701 AND activity='searches'`).Scan(&used)
	if used != 1 {
		t.Fatal("blocked cadence consumed quota", used)
	}
	if e := admitNetworkCadence(db, 701, "report", 3600000, "retry-key"); e != nil {
		t.Fatal(e)
	}
	if e := admitNetworkCadence(db, 701, "report", 3600000, "retry-key"); e != nil {
		t.Fatal("retry not idempotent", e)
	}
	if e := admitNetworkCadence(db, 701, "report", 3600000, "new-key"); e != errNetworkCadence {
		t.Fatal("cadence bypass", e)
	}
	// A later event must remain unread even after its author's earlier event was read.
	db.Exec(`INSERT INTO raw_items VALUES(714,702,'新到的内容',?); INSERT INTO processed_items VALUES(714,3); INSERT INTO agent_feed_exposures VALUES(701,'broadcast',714,'ugc',702)`, time.Now().UnixMilli())
	if call("GET", "/network", nil, 200)["unread"] != float64(1) {
		t.Fatal("read receipt acknowledged an unseen event")
	}
	// The actual route registration refuses an unauthenticated browser before DB access.
	protected := server.New()
	s.registerNetworkRoutes(protected)
	for _, path := range []string{"/api/v2/console/network", "/api/v2/console/network/nodes/702/events"} {
		r := ut.PerformRequest(protected.Engine, "GET", path, nil)
		if r.Code != 401 {
			t.Fatal(fmt.Sprintf("unauthenticated %s returned %d", path, r.Code))
		}
	}
	if os.Getenv("AGENTNET_SOCIAL_BROWSER_SCRIPT") != "" {
		runNetworkBrowser(t, s)
	}
	// Group and handoff evidence must preserve the same private audience as their
	// source APIs; attention without a source still belongs to the viewer's Agent.
	if e := db.Exec(`INSERT INTO social_groups VALUES(750,'已加入',702,1,1),(751,'未加入',703,1,1);
 INSERT INTO social_group_members(group_id,agent_id) VALUES(750,701),(750,702),(751,703);
 INSERT INTO social_group_messages VALUES(752,750,702,'agent','可见群消息',20),(753,751,703,'agent','其他群私密内容',21),(754,750,702,'human','人类写入不进入 Agent 图',22);
 INSERT INTO project_handoffs(handoff_id,sender_id,receiver_id,title,summary,markdown,idempotency_key,payload_hash,created_at) VALUES(755,702,701,'收到的交接','摘要','正文','network-visible','hash',23),(756,702,703,'别人的交接','秘密','秘密','network-hidden','hash',24);
 INSERT INTO agent_attention_items(attention_id,agent_id,source_type,source_id,surface,expires_at,title,body,created_at) VALUES(757,701,NULL,NULL,'focus',?,'无来源报告','本人 Agent 的结果',25),(758,701,'friend_request',720,'participation',?,'重复申请提醒','不能产生第二个审批',26);`, time.Now().Add(time.Hour).UnixMilli(), time.Now().Add(time.Hour).UnixMilli()).Error; e != nil {
		t.Fatal(e)
	}
	keys := map[string]bool{}
	for _, peer := range []string{"701", "702", "703", "705"} {
		for _, item := range call("GET", "/nodes/"+peer+"/events", nil, 200)["items"].([]any) {
			keys[item.(map[string]any)["event_key"].(string)] = true
		}
	}
	for _, key := range []string{"group-message:752", "handoff:755", "attention:757:1"} {
		if !keys[key] {
			t.Fatalf("missing visible evidence %s", key)
		}
	}
	for _, key := range []string{"group-message:753", "group-message:754", "handoff:756", "attention:758:1"} {
		if keys[key] {
			t.Fatalf("leaked or duplicated evidence %s", key)
		}
		call("POST", "/read", map[string]any{"event_key": key}, 404)
	}
	call("POST", "/read?other=1", map[string]any{"event_key": "handoff:755"}, 404)
	call("POST", "/read", map[string]any{"event_key": "handoff:755"}, 200)
	var handoffState string
	db.Raw(`SELECT state FROM project_handoffs WHERE handoff_id=755`).Scan(&handoffState)
	if handoffState != "pending" {
		t.Fatal("reading a handoff changed its execution/acknowledgement state", handoffState)
	}
}
