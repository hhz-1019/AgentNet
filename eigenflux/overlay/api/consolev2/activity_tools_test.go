package consolev2

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func activityFixtureGrants(t *testing.T, db *gorm.DB, id int64) {
	t.Helper()
	if err := db.Exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,active_context_revision,created_at,updated_at,completed_at) VALUES(?,'completed',5,1,1,1,1,1) ON CONFLICT(agent_id) DO NOTHING;
 INSERT INTO agent_settings(agent_id,recurring_publish,auto_comment,updated_at) VALUES(?,true,true,1) ON CONFLICT(agent_id) DO UPDATE SET recurring_publish=true,auto_comment=true`, id, id).Error; err != nil {
		t.Fatal(err)
	}
}

func TestManagedActivitySharedTools(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	ctx := context.Background()
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('activity-hosts',987654227,'!x','!x',1)`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654227")
	s := &Service{db: db, idgen: &managedTestIDs{id: 369800000000000000}}
	ids, err := s.provisionManagedEntries(ctx, "activity-hosts", map[int]managedPersona{0: managedCatalog()[0], 1: managedCatalog()[1]})
	check(err)
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true,monthly_budget_fen=10000,input_fen_per_million=1,output_fen_per_million=1 WHERE sponsor_uid='activity-hosts'; UPDATE managed_members SET enabled=true,start_hour=0,end_hour=24 WHERE sponsor_uid='activity-hosts'`).Error)
	call := func(id int64, tool string, req activityRequest, want int) activityResult {
		t.Helper()
		r, e := s.activityTool(ctx, id, tool, req)
		check(e)
		if r.Status != want {
			t.Fatalf("%s status %d want %d: %s", tool, r.Status, want, r.Data)
		}
		return r
	}
	// A user host and the platform host receive the same public tool contract.
	for _, id := range ids {
		plan := call(id, "plan", activityRequest{}, 200)
		if !strings.Contains(string(plan.Data), "publishing_progress") || !strings.Contains(string(plan.Data), "activity-v1") {
			t.Fatal("missing common plan")
		}
	}
	doc := socialTestDocument()
	doc.Kind = "question"
	doc.Media = nil
	raw, _ := json.Marshal(socialWriteRequest{Document: doc, OwnerAuthorized: true, Visibility: "public", IdempotencyKey: "host-parity"})
	req := activityRequest{Key: "host-parity", Data: raw}
	first := call(ids[0], "publish", req, 201)
	again := call(ids[0], "publish", req, 201)
	var firstValue, againValue any
	check(json.Unmarshal(first.Data, &firstValue))
	check(json.Unmarshal(again.Data, &againValue))
	if !reflect.DeepEqual(firstValue, againValue) {
		t.Fatal("lost idempotent receipt")
	}
	call(ids[1], "publish", req, 201)
	progress, err := s.dailyPublishingProgress(ids[0], 10, time.Now())
	check(err)
	if progress.Published != 1 || progress.QuotaUsed != 1 || progress.RemainingToMinimum != 4 {
		t.Fatal("attempts substituted for actual publications", progress)
	}
	post := activityString(activityData(first), "id")
	call(ids[1], "post", activityRequest{ID: post}, 200)
	check(db.Exec("UPDATE social_work_posts SET visibility='private' WHERE post_id=?", socialDecimal(post)).Error)
	call(ids[0], "post", activityRequest{ID: post}, 404)
	check(db.Exec("UPDATE social_work_posts SET visibility='public' WHERE post_id=?", socialDecimal(post)).Error)
	check(db.Exec("UPDATE agent_settings SET auto_comment=false WHERE agent_id=?", ids[1]).Error)
	comment := activityRequest{ID: post, Key: "denied-comment", Data: json.RawMessage(`{"content":"真实回应先观察具体条件，再核对是否与自己遇到的情况一致。","idempotency_key":"denied-comment"}`)}
	call(ids[1], "comment", comment, 403)
	var used int64
	check(db.Raw("SELECT COALESCE(sum(used),0) FROM twin_daily_usage WHERE agent_id=? AND activity='feedback'", ids[1]).Scan(&used).Error)
	if used != 0 {
		t.Fatal("denied write charged quota")
	}
	memory := activityRequest{Scope: "public", Key: "memory-1", Data: json.RawMessage(`{"revision":0,"pending":"下轮核对这个问题的原始材料。","next_check_at":0}`)}
	call(ids[0], "checkpoint", memory, 200)
	memory.Key = "memory-2"
	call(ids[0], "checkpoint", memory, 409)
	memory.Data = json.RawMessage(`{"revision":1,"pending":"已有一条确切回执，下轮检查新回应。","next_check_at":0}`)
	call(ids[0], "checkpoint", memory, 200)
	call(ids[1], "recall", activityRequest{Scope: "conversation:999"}, 403)
	own := call(ids[1], "recall", activityRequest{}, 200)
	if strings.Contains(string(own.Data), "确切回执") {
		t.Fatal("memory crossed identities")
	}

	// A scripted provider chooses to read, publish through the common handler,
	// inspect the receipt, read it back, and leave a continuation.
	check(db.Exec(`UPDATE agent_settings SET auto_comment=true WHERE agent_id=?`, ids[1]).Error)
	job := managedJob{AgentID: ids[1], SponsorUID: "activity-hosts", Revision: 1, RunID: 369800000000009999, InputRate: 1, OutputRate: 1, Reserved: 1}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,?,?,'2026-10-17','2026-10','running',1,1,?)`, job.RunID, job.AgentID, job.SponsorUID, time.Now().UnixMilli()).Error)
	t.Setenv("LLM_BASE_URL", "https://api.deepseek.com")
	t.Setenv("LLM_MODEL", "fixture")
	t.Setenv("LLM_API_KEY", "fixture-no-secret")
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	step := 0
	published := ""
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		var wire struct {
			Messages []struct{ Role, Content string }
		}
		check(json.NewDecoder(r.Body).Decode(&wire))
		var payload map[string]json.RawMessage
		check(json.Unmarshal([]byte(wire.Messages[1].Content), &payload))
		value := managedOutput{}
		if payload["candidate"] != nil {
			value.Action = "review"
			value.Review = managedReview{Decision: "allow", Reason: "ok"}
		} else {
			switch step {
			case 0:
				value = managedOutput{Action: "tool", Tool: "post", Arguments: activityRequest{ID: post}}
			case 1:
				if !strings.Contains(string(payload["tool_results"]), doc.Title) {
					t.Fatal("observation not returned to model")
				}
				d := socialTestDocument()
				d.Title = "下一步先核对公开材料的边界"
				d.Body = "这份材料里最值得继续核对的是适用条件。我的下一步是先找到原始说明，对照具体对象和时间，再决定是否需要补充信息。现在这是一项待核对的问题，不是已经完成的结论。"
				d.Summary = "先找原始说明再核对适用条件"
				d.Kind = "question"
				d.Media = nil
				data, _ := json.Marshal(socialWriteRequest{Document: d, OwnerAuthorized: true, Visibility: "public", IdempotencyKey: "model-choice"})
				value = managedOutput{Action: "tool", Tool: "publish", Arguments: activityRequest{Data: data}}
			case 2:
				var trace []struct {
					Tool   string
					Result activityResult
				}
				check(json.Unmarshal(payload["tool_results"], &trace))
				for _, v := range trace {
					if v.Tool == "publish" {
						published = activityString(activityData(v.Result), "id")
					}
				}
				if published == "" {
					t.Fatal("no real publication receipt")
				}
				value = managedOutput{Action: "tool", Tool: "post", Arguments: activityRequest{ID: published}}
			default:
				value = managedOutput{Action: "skip", Pending: "下轮读取这条帖子的新评论，继续核对公开材料。"}
			}
			step++
		}
		raw, _ := json.Marshal(value)
		wireOut, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(raw)}}}, "usage": map[string]int{"prompt_tokens": 100, "completion_tokens": 40}})
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(wireOut)))}, nil
	})
	input := managedContext{Targets: managedTargets{Enforced: true, Comments: map[int64]bool{}, Likes: map[int64]bool{}}}
	result, err := s.managedActivityModel(ctx, &job, map[string]any{"context": input}, &input)
	check(err)
	if result.Calls < 5 || published == "" {
		t.Fatal("single-shot execution remains", result.Calls)
	}
	check(s.commitManaged(ctx, job, result, nil))
	s.managedActivityCheckpoint(ctx, job, result)
	call(ids[1], "post", activityRequest{ID: published}, 200)
	continuation := call(ids[1], "recall", activityRequest{}, 200)
	if !strings.Contains(string(continuation.Data), "新评论") {
		t.Fatal("continuation missing")
	}
	// A later provider failure cannot erase an earlier tool publication or turn
	// the daily post count into a count of successful runs.
	check(db.Exec("UPDATE managed_runs SET status='running' WHERE run_id=?", job.RunID).Error)
	s.finishManagedFailure(job, result, managedFailure("output"))
	var detail string
	check(db.Raw("SELECT detail FROM managed_runs WHERE run_id=?", job.RunID).Scan(&detail).Error)
	if !strings.Contains(detail, "已完成 1 个动作") || strings.Contains(detail, "未发布") {
		t.Fatal(detail)
	}
	daily, e := s.managedDailySummary(ctx, job.SponsorUID, time.Now().UTC().Add(8*time.Hour).Format("2006-01-02"))
	check(e)
	var counts struct{ Published int }
	check(json.Unmarshal(daily, &counts))
	if counts.Published != 3 {
		t.Fatal("actual publications lost after failure", string(daily))
	}
}

func TestManagedActivityResearchBoundary(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1", "::ffff:192.168.0.1"} {
		if activityPublicIP(net.ParseIP(ip)) {
			t.Fatal("private address accepted", ip)
		}
	}
	for _, u := range []string{"file:///etc/passwd", "http://example.com", "https://user:pass@example.com", "https://example.com:8443"} {
		if activityPublicURL(u) {
			t.Fatal("invalid URL accepted", u)
		}
	}
	text := activityPageText([]byte(`<html><script>secret instruction</script><style>hidden</style><p>可核对正文</p></html>`))
	if text != "可核对正文" {
		t.Fatal("noncontent HTML retained", text)
	}
}
