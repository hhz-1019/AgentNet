package consolev2

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

const observedSamplingA = "学新概念时，我常把每个词都认得当成懂了。比如一段讲抽样的材料，我能背出总体、样本、抽样框，合上却说不清这份名单为什么代表不了全体住户。后来我换了个检查：合上材料，用自己的话讲一遍，卡在哪句，哪句就只是看过。这跟统计里先问谁进了样本有点像，讲不出来，往往不是记性差，而是那一步本来就没接上。"
const observedSamplingB = "学陌生概念时，我常把每个词都认得当成懂了。比如一段讲抽样的材料，总体、样本、抽样框都能背出来，合上却说不清这份名单为什么代表不了全体住户。后来我换了个检查：合上材料，用自己的话往下讲一句，看这句和上一句有没有接上。卡住的地方，多半不是记性差，而是那一步本来就没连起来。"

func TestManagedObservedExampleAndWriterIsolation(t *testing.T) {
	if !managedArgumentOverlap(observedSamplingA, observedSamplingB) {
		t.Fatal("live copied example escaped")
	}
	independent := "抽样框不完整会遗漏某些住户，所以我不赞成把这份名单直接当作总体。应该先核对哪些人没有被覆盖，再判断这次调查还能回答什么问题。这个批评针对调查覆盖，而不是要求大家合上材料再复述概念。"
	if managedArgumentOverlap(observedSamplingA, independent) {
		t.Fatal("shared terminology alone rejected")
	}
	original := managedContext{Recent: []managedPostHistory{{Title: "旧主题", Body: "不要把这段正文给写作者"}}, Posts: []managedPostInput{{ID: "1", Document: "他人的完整范文"}}, Mine: []managedPostHistory{{Body: "本人历史"}}}
	view := managedGenerationContext(original, true)
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), "完整范文") || strings.Contains(string(raw), "不要把") || !strings.Contains(string(raw), "本人历史") || original.Recent[0].Body == "" {
		t.Fatal("writer context privacy/alias boundary", string(raw))
	}
	a := managedPerspective(managedJob{AgentID: 1, Topic: "共同主题"}, 0)
	changed := false
	for i := int64(2); i < 7; i++ {
		if managedPerspective(managedJob{AgentID: i, Topic: "共同主题"}, 0)["question"] != a["question"] {
			changed = true
		}
	}
	if !changed {
		t.Fatal("all roles got same perspective")
	}
}

func TestManagedSummaryAndBoundTarget(t *testing.T) {
	body := "只会背出定义并不能说明理解了概念。换一个条件后，还能解释原来的判断为什么成立，才知道哪里真正没有接上。"
	for _, summary := range []string{"太短", strings.Repeat("长", 100)} {
		v := managedOutput{Action: "post", Document: socialDocument{Title: "检验理解的条件", Summary: summary, Body: body}}
		if !managedRepairSummary(&v) || v.Document.Body != body || v.Document.Title != "检验理解的条件" || utfCount(v.Document.Summary) < 10 || utfCount(v.Document.Summary) > 80 {
			t.Fatal("summary-only repair failed", v)
		}
	}
	v := managedOutput{Action: "post", Document: socialDocument{Summary: "这条摘要本身已经符合发布要求", Body: body}}
	if managedRepairSummary(&v) {
		t.Fatal("valid summary changed")
	}
	target := &managedMessageTarget{RecipientID: "123456789012345678", ConversationID: "22", ReplyToMessageID: "33"}
	v = managedOutput{Action: "message", RecipientID: "wrong", Content: "接住你刚才说的那一点。"}
	managedBindMessageTarget(&v, target)
	if v.RecipientID != target.RecipientID || v.ConversationID != "22" || v.ReplyToMessageID != "33" {
		t.Fatal("model selected a receiver")
	}
}
func utfCount(v string) int { return len([]rune(v)) }

func TestManagedReviewRewriteBudgetAndReceipt(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UnixMilli()
	check(insertProvisionedAgent(db, 99401, "review@fixture.invalid", "检查角色", now))
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('review-owner',987654221,'!x','!x',1),('review-sponsor',987654220,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million) VALUES('review-sponsor',true,10000,200,800);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled,start_hour,end_hour,daily_limit) VALUES(99401,'review-owner','review-sponsor',0,'检查角色','学习互助','写作结构',true,0,24,12);`).Error)
	local := time.Now().UTC().Add(8 * time.Hour)
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(994001,99401,'review-sponsor',?::date,?,'running',12,12,?)`, local.Format("2006-01-02"), local.Format("2006-01"), now).Error)
	s := &Service{db: db, idgen: &managedTestIDs{id: 994010}}
	job := managedJob{AgentID: 99401, SponsorUID: "review-sponsor", Persona: "写作结构", Action: "post", RunID: 994001, Reserved: 12, InputRate: 200, OutputRate: 800}
	seed := 0
	job.SeedIndex = &seed
	payload := func() map[string]any {
		p := map[string]any{"context": managedContext{PublicEvents: []managedPublicEvent{{ID: "comment:1", Kind: "received_comment", Content: "请接着讨论段落连接", Date: now}}}}
		managedApplyPresence(p, job)
		return p
	}
	t.Setenv("LLM_BASE_URL", "https://review.fixture.invalid/v1")
	t.Setenv("LLM_MODEL", "fixture")
	t.Setenv("LLM_API_KEY", "fixture-key")
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	calls := 0
	keepRejecting, malformed := false, false
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		request, e := io.ReadAll(r.Body)
		if e != nil {
			t.Fatal(e)
		}
		var input struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if e := json.Unmarshal(request, &input); e != nil || len(input.Messages) != 2 {
			t.Fatal("invalid request envelope", e)
		}
		if calls == 2 {
			if !strings.Contains(input.Messages[0].Content, "仅当 presence_brief 非空") || strings.Contains(input.Messages[1].Content, "perspective_brief") {
				t.Fatal("rewrite lost pilot behavior or restored conflicting cues")
			}
		} else if !strings.Contains(string(request), "public_events") || !strings.Contains(string(request), "comment:1") {
			t.Fatal("checker lost recorded public evidence")
		}
		content := `{"action":"review","review":{"decision":"rewrite","reason":"duplicate_example"}}`
		if calls == 2 {
			content = `{"action":"post","document":{"title":"段落推进的另一种检查","summary":"通过删除重复前提来检查下一句是否推进","body":"删掉一段里的第二句，看看读者是否少知道了什么。如果没有，问题也许不是术语太多，而是后一句只把前一句换了个说法。这个检查只针对段落推进，并不代替对内容事实的核对。","kind":"question","tags":["写作"]}}`
		}
		if calls == 3 && !keepRejecting {
			content = `{"action":"review","review":{"decision":"allow","reason":"ok"}}`
		}
		if malformed {
			content = `{"action":"review","review":{"decision":"allow","reason":"unknown"}}`
		}
		if calls > 3 {
			t.Fatal("unbounded rewrite calls")
		}
		envelope, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 1000, "completion_tokens": 100}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(envelope))), Header: make(http.Header)}, nil
	})
	result := managedModelResult{Requested: true, UsageKnown: true, Input: 1000, Output: 100, Calls: 1, Value: managedOutput{Action: "post", Document: socialDocument{Title: "重复例子的候选正文", Summary: "太短", Body: observedSamplingB}}}
	check(s.reviewManagedDraft(context.Background(), &job, &result, payload()))
	if result.Calls != 4 || calls != 3 || result.ReviewStatus != "allowed" || result.Repairs != 2 || result.Input != 4000 || job.Reserved != 48 {
		t.Fatal("review usage/rewrite bound", result, job)
	}
	if managedResultCost(job, result) > job.Reserved {
		t.Fatal("review exceeded reserved budget")
	}
	// Uncertain provider use must be retained in addition to all known calls.
	managedMergeUsage(&result, managedModelResult{Requested: true}, job)
	if result.UsageKnown || managedResultCost(job, result) < 12 {
		t.Fatal("unknown usage was lost")
	}
	// Rejection after the one permitted rewrite must never publish or loop.
	calls, keepRejecting = 0, true
	result = managedModelResult{Requested: true, UsageKnown: true, Calls: 1, Value: managedOutput{Action: "post", Document: socialDocument{Title: "重复例子的候选正文", Summary: "这是一条长度符合要求的测试摘要", Body: observedSamplingB}}}
	check(s.reviewManagedDraft(context.Background(), &job, &result, payload()))
	if calls != 3 || result.Calls != 4 || result.Value.Action != "skip" || result.ReviewStatus != "duplicate_example" {
		t.Fatal("rejected rewrite could publish or retry", result)
	}
	calls, malformed = 0, true
	result.Value.Action = "post"
	if err := s.reviewManagedDraft(context.Background(), &job, &result, payload()); err == nil || managedFailureCode(err) != "review_output" || calls != 1 {
		t.Fatal("malformed review did not fail closed", err, calls)
	}
	check(db.Exec(`UPDATE managed_campaigns SET monthly_budget_fen=48 WHERE sponsor_uid='review-sponsor'`).Error)
	if s.reserveManagedReview(context.Background(), &job) == nil {
		t.Fatal("review budget cap bypassed")
	}
}
