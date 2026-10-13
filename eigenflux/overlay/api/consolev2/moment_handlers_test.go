package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/alicebob/miniredis/v2"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/redis/go-redis/v9"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMomentDecisionLifecycle(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture required")
	}
	db := socialFixtureDB(t, dsn)
	must := func(sql string, args ...any) {
		t.Helper()
		if e := db.Exec(sql, args...).Error; e != nil {
			t.Fatal(e)
		}
	}
	// The suite shares a minimal social schema. Add the real command columns and
	// apply the production Attention CHECK constraints below.
	must(`CREATE TABLE agent_attention_items(attention_id BIGSERIAL PRIMARY KEY,agent_id BIGINT,
 title TEXT,body TEXT,recommendation TEXT,producer TEXT,protocol_version TEXT,attention_phase TEXT,
 surface TEXT,category TEXT,client_item_id TEXT,payload_hash TEXT,language TEXT,source_type TEXT,source_id BIGINT,
 source_ref JSONB,context_ref JSONB,actions_snapshot JSONB,status TEXT,item_revision BIGINT,
 selected_action_key TEXT,response_status TEXT,generated_at BIGINT,created_at BIGINT,updated_at BIGINT,responded_at BIGINT,expires_at BIGINT);
 CREATE SEQUENCE moment_command_seq START 10000;
 ALTER TABLE agent_commands ALTER COLUMN command_id SET DEFAULT nextval('moment_command_seq'),
 ADD COLUMN attention_id BIGINT, ADD COLUMN payload_hash TEXT, ADD COLUMN required_context_revision BIGINT,
 ADD COLUMN idempotency_key TEXT,ADD COLUMN claim_owner_runtime_id TEXT,ADD COLUMN attempt_count INT DEFAULT 0,
 ADD COLUMN delivered_at BIGINT,ADD COLUMN completed_at BIGINT;
 ALTER TABLE agent_commands ALTER COLUMN claim_epoch SET DEFAULT 0;
 CREATE UNIQUE INDEX moment_command_idempotency ON agent_commands(agent_id,idempotency_key);
 CREATE TABLE agent_context_heads(agent_id BIGINT PRIMARY KEY,active_revision BIGINT);
 CREATE TABLE agent_onboarding_v2(agent_id BIGINT PRIMARY KEY,state TEXT);
 INSERT INTO agent_onboarding_v2 VALUES(1,'completed'),(2,'completed');
 CREATE TABLE agent_context_revisions(agent_id BIGINT,revision BIGINT,PRIMARY KEY(agent_id,revision));
 INSERT INTO agent_context_heads VALUES(1,1),(2,1);
 INSERT INTO agent_context_revisions VALUES(1,1),(1,2),(2,1);
 CREATE TABLE agent_runtime_leases(agent_id BIGINT,runtime_instance_id TEXT,context_revision_applied BIGINT,lease_until BIGINT,PRIMARY KEY(agent_id,runtime_instance_id));
 CREATE TABLE control_wakeup_outbox(agent_id BIGINT,event_type TEXT,entity_id BIGINT,payload JSONB,status TEXT,next_attempt_at BIGINT,created_at BIGINT);
 CREATE TABLE agent_idempotency_requests(agent_id BIGINT,operation TEXT,idempotency_key TEXT,request_hash TEXT,response_snapshot JSONB,expires_at BIGINT,created_at BIGINT,PRIMARY KEY(agent_id,operation,idempotency_key));`)
	migration, e := os.ReadFile("../../migrations/000080_console_v2_agent_attention_contract.sql")
	if e != nil {
		t.Fatal(e)
	}
	must(strings.Split(string(migration), "-- +goose Down")[0])
	redisServer := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = rc.Close() })
	s := &Service{db: db, redisClient: rc, otpPepper: "isolated-test"}
	previewPort := os.Getenv("AGENTNET_MOMENT_PREVIEW_PORT")
	h := server.New()
	if previewPort != "" {
		h = server.New(server.WithHostPorts("127.0.0.1:" + previewPort))
	}
	inject := func(ctx context.Context, c *app.RequestContext) {
		id := int64(1)
		if string(c.GetHeader("Test-Viewer")) == "2" {
			id = 2
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	h.POST("/publish", inject, s.publishAttentionItems)
	h.GET("/moment", inject, s.listMoment)
	h.POST("/items/:attention_id/respond", inject, s.respondAttentionItem)
	h.POST("/items/:attention_id/state", inject, s.changeMomentState)
	h.GET("/pending", inject, s.listPendingCommands)
	h.POST("/commands/:command_id/claim", inject, s.claimAgentCommand)
	h.POST("/commands/:command_id/renew", inject, s.renewMomentCommand)
	h.POST("/commands/:command_id/complete", inject, s.completeAgentCommand)
	if previewPort != "" {
		h.GET("/api/v2/console/moment", inject, s.listMoment)
		h.POST("/api/v2/console/attention-items/:attention_id/respond", inject, s.respondAttentionItem)
		h.POST("/api/v2/console/moment/:attention_id/state", inject, s.changeMomentState)
		h.GET("/api/v2/console/avatars", inject, func(_ context.Context, c *app.RequestContext) {
			reply(c, 200, map[string]any{"avatars": map[string]string{}})
		})
		h.GET("/api/v2/agent-commands/pending", inject, s.listPendingCommands)
		h.POST("/api/v2/agent-commands/:command_id/claim", inject, s.claimAgentCommand)
		h.POST("/api/v2/agent-commands/:command_id/renew", inject, s.renewMomentCommand)
		h.POST("/api/v2/agent-commands/:command_id/complete", inject, s.completeAgentCommand)
		h.GET("/api/v2/moment-preview/context", inject, func(_ context.Context, c *app.RequestContext) {
			reply(c, 200, map[string]any{"fixture": "moment-isolated-v1", "control_context": map[string]any{"revision": 1, "purpose": "只验证临时目录草稿"}})
		})
		h.POST("/api/v2/moment-preview/heartbeat", inject, func(_ context.Context, c *app.RequestContext) {
			db.Exec("UPDATE agent_runtime_leases SET lease_until=? WHERE agent_id=1 AND runtime_instance_id='runtime'", time.Now().UnixMilli()+120000)
			reply(c, 200, map[string]any{})
		})
	}
	call := func(method, path string, body any, viewer string, want int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		resp := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(data)), Len: len(data)},
			ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Test-Viewer", Value: viewer})
		if resp.Code != want {
			t.Fatalf("%s %s got %d want %d: %s", method, path, resp.Code, want, resp.Body.String())
		}
		var result map[string]any
		if json.Unmarshal(resp.Body.Bytes(), &result) != nil {
			t.Fatal("invalid JSON")
		}
		out, _ := result["data"].(map[string]any)
		return out
	}
	now := time.Now().UnixMilli()
	must("INSERT INTO agent_runtime_leases VALUES(1,'runtime',1,?)", now+600000)
	publish := func(n int) string {
		t.Helper()
		// The lifecycle fixture needs more than the four-per-hour participation
		// quota; age earlier rows instead of weakening the production limiter.
		if n >= 5 {
			must("UPDATE agent_attention_items SET created_at=? WHERE agent_id=1", now-3601000)
		}
		batch := map[string]any{"schema_version": "agent_attention.v1", "idempotency_key": fmt.Sprint("moment-", n), "items": []any{map[string]any{
			"client_item_id": fmt.Sprint("moment-", n), "surface": "participation", "category": "other_decision", "language": "zh-CN",
			"title": "整理一份研究草稿？", "body": "请根据现有材料整理一个草稿。", "recommendation": "仅保存草稿供主人审阅。",
			"context_ref":  map[string]any{"context_revision": 1, "moment": map[string]any{"related_agent_id": "2", "priority": 90, "executor_id": "test_host", "scopes": map[string]string{"yes": "只写草稿，不公开发送。"}}},
			"actions":      []any{map[string]string{"action_key": "yes", "kind": "custom", "flag": "整理草稿", "appearance": "primary"}},
			"generated_at": now, "expires_at": now + 3600000}}}
		result := call("POST", "/publish", batch, "1", 201)
		return result["items"].([]any)[0].(map[string]any)["attention_id"].(string)
	}
	approve := func(id string, revision int, key string) map[string]any {
		return call("POST", "/items/"+id+"/respond", map[string]any{"action_key": "yes", "expected_item_revision": revision, "idempotency_key": key, "condition": "只使用已公开材料"}, "1", 202)
	}
	id := publish(1)
	if len(call("GET", "/moment", nil, "2", 200)["items"].([]any)) != 0 {
		t.Fatal("owner isolation failed")
	}
	items := call("GET", "/moment", nil, "1", 200)["items"].([]any)
	if items[0].(map[string]any)["related_agent"].(map[string]any)["agent_id"] != "2" {
		t.Fatal("peer grouping lost")
	}
	call("POST", "/items/"+id+"/respond", map[string]any{"action_key": "yes", "expected_item_revision": 1, "idempotency_key": "other-owner-01"}, "2", 409)
	saved := approve(id, 1, "approval-one")
	command := saved["command_id"].(string)
	request := map[string]any{"action_key": "yes", "expected_item_revision": 1, "idempotency_key": "approval-one", "condition": "只使用已公开材料"}
	if call("POST", "/items/"+id+"/respond", request, "1", 200)["command_id"] != command {
		t.Fatal("idempotency lost")
	}
	request["condition"] = "更改条件"
	call("POST", "/items/"+id+"/respond", request, "1", 409)
	claimRequest := map[string]any{"runtime_instance_id": "runtime", "applied_context_revision": 1, "executor_id": "wrong"}
	call("POST", "/commands/"+command+"/claim", claimRequest, "1", 409)
	claimRequest["executor_id"] = "test_host"
	claim := call("POST", "/commands/"+command+"/claim", claimRequest, "1", 200)
	payload := claim["payload"].(map[string]any)
	if payload["condition"] != "只使用已公开材料" || payload["authorization_scope"] != "只写草稿，不公开发送。" {
		t.Fatal("frozen grant lost")
	}
	proof := map[string]any{"runtime_instance_id": "runtime", "claim_token": claim["claim_token"], "claim_epoch": claim["claim_epoch"], "executor_id": "test_host"}
	call("POST", "/commands/"+command+"/renew", proof, "1", 200)
	proof["executor_id"]="wrong"
	call("POST", "/commands/"+command+"/renew", proof, "1", 409)
	proof["executor_id"]="test_host"
	call("POST", "/items/"+id+"/state", map[string]any{"action": "revoke", "expected_item_revision": 2}, "1", 409)
	result := map[string]any{"summary": "已保存草稿。", "execution": map[string]any{"host_id": "test_host", "session_id": "actual-session", "input_hash": strings.Repeat("a", 64), "evidence": "草稿已读回核对。"}}
	complete := map[string]any{"runtime_instance_id": "runtime", "claim_token": claim["claim_token"], "claim_epoch": claim["claim_epoch"], "status": "completed", "result": result}
	call("POST", "/commands/"+command+"/complete", complete, "1", 200)
	call("POST", "/commands/"+command+"/complete", complete, "1", 200)
	got := call("GET", "/moment", nil, "1", 200)["items"].([]any)[0].(map[string]any)
	if got["status"] != "acted" || got["command"].(map[string]any)["result"].(map[string]any)["execution"] == nil {
		t.Fatalf("receipt missing: %#v", got)
	}
	id = publish(2)
	saved = approve(id, 1, "approval-two")
	command = saved["command_id"].(string)
	call("POST", "/items/"+id+"/state", map[string]any{"action": "revoke", "expected_item_revision": 2}, "1", 200)
	call("POST", "/commands/"+command+"/claim", claimRequest, "1", 409)
	call("POST", "/items/"+id+"/state", map[string]any{"action": "reopen", "expected_item_revision": 3}, "1", 200)
	approve(id, 4, "approval-two-again")
	id = publish(3)
	saved = approve(id, 1, "approval-three")
	command = saved["command_id"].(string)
	must("UPDATE agent_attention_items SET expires_at=? WHERE attention_id=?", now-1, id)
	call("POST", "/commands/"+command+"/claim", claimRequest, "1", 409)
	call("GET", "/pending?command_type=attention_response", nil, "1", 200)
	var status string
	db.Raw("SELECT status FROM agent_commands WHERE command_id=?", command).Scan(&status)
	if status != "expired" {
		t.Fatal("expired command still available")
	}
	id = publish(4)
	saved = approve(id, 1, "approval-four")
	command = saved["command_id"].(string)
	claim = call("POST", "/commands/"+command+"/claim", claimRequest, "1", 200)
	must("UPDATE agent_attention_items SET expires_at=? WHERE attention_id=?",now-1,id)
	call("POST","/commands/"+command+"/complete",map[string]any{"runtime_instance_id":"runtime","claim_token":claim["claim_token"],"claim_epoch":claim["claim_epoch"],"status":"completed","result":result},"1",409)
	must("UPDATE agent_attention_items SET expires_at=? WHERE attention_id=?",now+3600000,id)
	must("UPDATE agent_commands SET claim_until=? WHERE command_id=?", now-1, command)
	call("GET", "/pending?command_type=attention_response", nil, "1", 200)
	call("POST", "/commands/"+command+"/claim", claimRequest, "1", 409)
	db.Raw("SELECT status FROM agent_commands WHERE command_id=?", command).Scan(&status)
	if status != "failed" {
		t.Fatal("abandoned command not quarantined")
	}
	id = publish(5)
	must("UPDATE agent_context_heads SET active_revision=2 WHERE agent_id=1")
	call("POST", "/items/"+id+"/respond", map[string]any{"action_key": "yes", "expected_item_revision": 1, "idempotency_key": "stale-context-01"}, "1", 409)
	must("UPDATE agent_context_heads SET active_revision=1 WHERE agent_id=1")
	if previewPort != "" {
		must("UPDATE agent_commands SET status='failed',result='{\"summary\":\"历史联调记录，未再次执行。\"}' WHERE status IN ('pending','notified')")
		must("UPDATE agent_attention_items SET status='dismissed' WHERE status IN ('pending','open')")
		fresh := publish(6)
		must("UPDATE agent_attention_items SET title='保存这份联调草稿？',body='原始材料：此刻功能已连接决定队列。请将这句话原样写入当前临时工作目录的 moment-approved.md，并读回核对。',recommendation='仅保存这一句联调草稿，不发送消息或公开发布。',context_ref=jsonb_set(context_ref,'{moment,related_agent_id}', '\"1\"'::jsonb) WHERE attention_id=?", fresh)
		fmt.Println("MOMENT_PREVIEW_READY http://127.0.0.1:" + previewPort)
		h.Spin()
	}
}
