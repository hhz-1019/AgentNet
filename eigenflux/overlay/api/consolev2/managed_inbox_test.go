package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagedAnyUserInbox(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	t.Cleanup(func() { db.Rollback() })
	// A quiet response must persist its receipt for 64-bit conversation IDs too.
	s := &Service{db: db, idgen: &managedTestIDs{id: 369454428261974100}}
	ctx := context.Background()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []int64{98401, 98402, 98403} {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@inbox.invalid", "验收"+fmtRun(id), 1))
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('inbox-operator',987654321,'!x','!x',1),('inbox-system',987654322,'!x','!x',1),('inbox-user',987654323,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million,dm_reply_enabled,dm_start_enabled) VALUES('inbox-operator',true,10000,1,1,true,true);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled) VALUES(98401,'inbox-system','inbox-operator',0,'系统验收','学习互助','测试',true);
 INSERT INTO agent_settings(agent_id,auto_reply_pm,auto_start_pm,updated_at) VALUES(98401,true,true,1),(98402,true,true,1) ON CONFLICT(agent_id) DO UPDATE SET auto_reply_pm=true,auto_start_pm=true;
 INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(98402,'inbox-user',1);`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654321")
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(98402)); c.Next(ctx) }
	h.POST("/agent", auth, s.agentMessagePermission(), func(_ context.Context, c *app.RequestContext) {
		t.Error("system inbox fell through to friend-only RPC")
		c.Status(500)
	})
	h.POST("/human", auth, s.sendHumanPM)
	h.GET("/empty-inbox", auth, s.listCommunicationConversations)
	emptyInbox := ut.PerformRequest(h.Engine, "GET", "/empty-inbox", nil)
	var emptyResult struct {
		Data struct {
			Conversations json.RawMessage `json:"conversations"`
		} `json:"data"`
	}
	check(json.Unmarshal(emptyInbox.Body.Bytes(), &emptyResult))
	if emptyInbox.Code != 200 || string(emptyResult.Data.Conversations) != "[]" {
		t.Fatalf("empty inbox must return an array: %d %s", emptyInbox.Code, emptyInbox.Body.String())
	}
	call := func(path string, body any, want int) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, "POST", path, &ut.Body{Body: strings.NewReader(string(raw)), Len: len(raw)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s: %d %s", path, r.Code, r.Body.String())
		}
		var out map[string]any
		check(json.Unmarshal(r.Body.Bytes(), &out))
		return out
	}
	request := map[string]any{"receiver_id": "98401", "content": "我想讨论一下错题记录是否应该保留反例。"}
	first := call("/agent", request, 200)
	data := first["data"].(map[string]any)
	conv := data["conv_id"].(string)
	again := call("/agent", request, 200)
	if again["data"].(map[string]any)["msg_id"] != data["msg_id"] {
		t.Fatal("API retry resent message")
	}
	var count int64
	check(db.Raw(`SELECT count(*) FROM user_relations WHERE from_uid IN (98401,98402)`).Scan(&count).Error)
	if count != 0 {
		t.Fatal("non-friend contact created a friendship")
	}
	call("/agent", map[string]any{"conv_id": conv, "content": "第二条：我关心的是怎样找到不满足条件的例子。"}, 200)
	call("/agent", map[string]any{"conv_id": conv, "content": "第三条：可以等你有空再回复，不需要现在补完整方案。"}, 200)
	call("/agent", map[string]any{"conv_id": conv, "content": "第四条：这条应当等对方先回复才能发。"}, 429)
	job := managedJob{AgentID: 98401, SponsorUID: "inbox-operator", Scenario: "学习互助", Revision: 1, RunID: 984100, Reserved: 10, InputRate: 1, OutputRate: 1}
	input, err := s.managedContext(ctx, job)
	check(err)
	if input.Message == nil || input.Message.RecipientID != "98402" {
		t.Fatal("non-friend incoming API message not replyable")
	}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(984100,98401,'inbox-operator','2026-10-15','2026-10','running',10,10,?)`, time.Now().UnixMilli()).Error)
	value := managedModelResult{Targets: input.Targets, UsageKnown: true, Input: 20, Output: 20, Value: managedOutput{Action: "message", RecipientID: "98402", ConversationID: conv, ReplyToMessageID: input.Message.ReplyToMessageID, Content: "你关心的是条件失效的反例，我也更在意能否准确指出条件在哪里被用到。"}}
	check(s.commitManaged(ctx, job, value, nil))
	// Web owners can continue this same non-friend conversation.
	call("/human", map[string]any{"conv_id": conv, "content": "那我们先从只改变一个条件开始讨论。", "idempotency_key": "inbox-human-reply-1"}, 201)
	check(db.Raw(`SELECT count(*) FROM private_messages WHERE conv_id=? AND actor_kind='human' AND receiver_id=98401`, socialDecimal(conv)).Scan(&count).Error)
	if count != 1 {
		t.Fatal("web owner reply not stored")
	}
	check(db.Exec(`UPDATE managed_message_receipts SET created_at=?`, time.Now().Add(-31*time.Minute).UnixMilli()).Error)
	input, err = s.managedContext(ctx, job)
	check(err)
	if input.Message == nil {
		t.Fatal("human-authored incoming message excluded")
	}
	// A separately selected, unrelated active user is a valid outgoing target.
	job.RecipientID = 98403
	job.RunID++
	input, err = s.managedContext(ctx, job)
	check(err)
	if input.Message == nil || input.Message.RecipientID != "98403" {
		t.Fatal("arbitrary user initiation unavailable")
	}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,98401,'inbox-operator','2026-10-15','2026-10','running',10,10,?)`, job.RunID, time.Now().UnixMilli()).Error)
	value.Targets = input.Targets
	value.Value = managedOutput{Action: "message", RecipientID: "98403", Content: "你好，我想和你讨论错题记录里的反例，不方便的话可以不回复。"}
	check(s.commitManaged(ctx, job, value, nil))
	check(db.Raw(`SELECT count(*) FROM private_messages pm JOIN conversations c USING(conv_id) WHERE pm.sender_id=98401 AND pm.receiver_id=98403 AND c.origin_type='direct'`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("arbitrary user message not delivered")
	}
	job.RecipientID = 0
	job.RunID++
	input, err = s.managedContext(ctx, job)
	check(err)
	if input.Message == nil || input.Message.RecipientID != "98402" {
		t.Fatal("web reply candidate missing")
	}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,98401,'inbox-operator','2026-10-15','2026-10','running',10,10,?)`, job.RunID, time.Now().UnixMilli()).Error)
	check(s.commitManaged(ctx, job, managedModelResult{Targets: input.Targets, UsageKnown: true, Input: 20, Output: 20, Value: managedOutput{Action: "skip"}}, nil))
	input, err = s.managedContext(ctx, job)
	check(err)
	if input.Message != nil {
		t.Fatal("intentional skip repeatedly reconsidered the same incoming message")
	}
	// Both directions obey a later block and never silently reopen closed threads.
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(98401,98402,2,1)`).Error)
	call("/agent", map[string]any{"conv_id": conv, "content": "这条在被屏蔽后不应被发送。"}, 403)
	call("/human", map[string]any{"conv_id": conv, "content": "这条网页消息也不应发送。", "idempotency_key": "blocked-inbox-web"}, 403)
	check(db.Exec(`DELETE FROM user_relations WHERE from_uid=98401 AND to_uid=98402;UPDATE conversations SET topic_status=2 WHERE conv_id=?`, socialDecimal(conv)).Error)
	call("/agent", map[string]any{"conv_id": conv, "content": fmt.Sprint("关闭后不重新开启", conv)}, 403)
}
