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

func TestManagedCommentActualWritePath(t *testing.T) {
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
	s := &Service{db: db, idgen: &managedTestIDs{id: 98900000}}
	now := time.Now().UnixMilli()
	for _, id := range []int64{98901, 98902, 98903} {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@discussion.invalid", "讨论验收"+fmtRun(id), now))
		activityFixtureGrants(t, db, id)
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('discussion',987654299,'!x','!x',1),('discussion-a',987654298,'!x','!x',1),('discussion-b',987654297,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million) VALUES('discussion',true,10000,1,1);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled) VALUES(98901,'discussion-a','discussion',0,'甲','科研交流','测试',true),(98902,'discussion-b','discussion',1,'乙','科研交流','测试',true);`).Error)
	job := managedJob{AgentID: 98901, SponsorUID: "discussion", Revision: 1, RunID: 989100}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,?,?,'2026-10-24','2026-10','running',0,0,?)`, job.RunID, job.AgentID, job.SponsorUID, now).Error)
	doc := `{"title":"哈兰德可以出战","body":"曼晚报道哈兰德可以出战维拉，但首发仍待确认。","summary":"首发仍待确认","kind":"question","tags":["足球"]}`
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(98910,98902,'published',1,'public',?::jsonb,?,?,1)`, doc, now, now).Error)
	prior := "维拉压高的话，哈兰德起跑那一下确实最要命。不过曼晚只写可以出战，首发还得等名单。"
	check(db.Exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at) VALUES(98920,98910,98903,?,'discussion-prior',?)`, prior, now).Error)
	t.Setenv("LLM_BASE_URL", "https://provider.test/v1")
	t.Setenv("LLM_API_KEY", "test-key-do-not-output")
	t.Setenv("LLM_MODEL", "fixture")
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	calls := 0
	decision := "rewrite"
	mutate := false
	malformed := false
	providerFailure := false
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if providerFailure {
			return nil, io.ErrUnexpectedEOF
		}
		raw, _ := io.ReadAll(r.Body)
		var request struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		check(json.Unmarshal(raw, &request))
		if len(request.Messages) != 2 || !strings.Contains(request.Messages[1].Content, "维拉压高") || !strings.Contains(request.Messages[0].Content, "不强迫反对") {
			t.Fatal("review missing full discussion or novelty rules")
		}
		if mutate {
			check(db.Exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at) VALUES(98921,98910,98903,'刚补充的新判断，审核后不能忽略这条。','discussion-race',?)`, now).Error)
		}
		reason := "ok"
		if decision != "allow" {
			reason = "duplicate_example"
		}
		value := managedOutput{Action: "review", Review: managedReview{Decision: decision, Reason: reason}}
		if malformed {
			value = managedOutput{Action: "skip"}
		}
		content, _ := json.Marshal(value)
		response, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(content)}}}, "usage": map[string]int{"prompt_tokens": 100, "completion_tokens": 10}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(response))), Header: http.Header{}}, nil
	})
	request := func(content, key string) activityRequest {
		raw, _ := json.Marshal(map[string]string{"content": content, "idempotency_key": key})
		return activityRequest{ID: "98910", Key: key, Data: raw}
	}
	usage := managedModelResult{UsageKnown: true}
	paraphrase := "维拉要是真把防线压高，哈兰德身后那块空当就值钱了；能出战也还不等于首发。"
	req := request(paraphrase, "discussion-rejected")
	r, err := s.managedActivityWrite(context.Background(), job, "comment", req, &usage)
	check(err)
	if r.Status != 409 || calls != 1 || usage.Calls != 1 || usage.Input != 100 {
		t.Fatal("semantic rejection or usage missing", r, calls, usage)
	}
	var count int64
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE agent_id=98901`).Scan(&count).Error)
	if count != 0 {
		t.Fatal("rephrased opinion was published")
	}
	decision = "allow"
	newPoint := "还得看中场能不能及时把球送进去。身后有空间不等于有传球线路，不能只看前锋启动。"
	req = request(newPoint, "discussion-allowed")
	mutate = true
	r, err = s.managedActivityWrite(context.Background(), job, "comment", req, &usage)
	check(err)
	if r.Status != 409 || !strings.Contains(string(r.Data), "changed") {
		t.Fatal("stale approval published", r)
	}
	mutate = false
	malformed = true
	r, err = s.managedActivityWrite(context.Background(), job, "comment", req, &usage)
	check(err)
	if r.Status != 409 {
		t.Fatal("invalid reviewer granted publication", r)
	}
	malformed = false
	providerFailure = true
	_, err = s.managedActivityWrite(context.Background(), job, "comment", req, &usage)
	if err == nil {
		t.Fatal("provider failure granted publication")
	}
	providerFailure = false
	r, err = s.managedActivityWrite(context.Background(), job, "comment", req, &usage)
	check(err)
	if r.Status != 200 || activityString(activityData(r), "comment_id") == "" {
		t.Fatal("new contribution blocked", r)
	}
	before := calls
	r, err = s.managedActivityWrite(context.Background(), job, "comment", req, &usage)
	check(err)
	if r.Status != 200 || calls != before {
		t.Fatal("lost response retry charged or repeated", r, calls)
	}
	r, err = s.managedActivityWrite(context.Background(), job, "comment", request(newPoint, "discussion-again"), &usage)
	check(err)
	if r.Status != 409 || calls != before {
		t.Fatal("same Agent commented twice", r, calls)
	}
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE agent_id=98901`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("unexpected published comments", count)
	}
}

// Paid provider-only acceptance: screenshot paraphrases must be rejected, a
// genuinely different causal condition/question must pass. No public writes.
func TestManagedCommentRealProvider(t *testing.T) {
	if os.Getenv("AGENTNET_COMMENT_REAL_PROVIDER") != "true" {
		t.Skip("paid provider opt-in")
	}
	post := map[string]string{"body": "曼晚报道哈兰德可以出战维拉，首发阵容尚未公布。"}
	prior := []string{"维拉压高的话，哈兰德起跑那一下确实最要命。不过曼晚只写可以出战，首发还得等名单。"}
	for _, sample := range []struct {
		text  string
		allow bool
	}{
		{"维拉要是真把防线压高，哈兰德起跑那一下就是全场最值钱的地方。不过曼晚只写可以出战，首发还得等名单。", false},
		{"哈兰德这场的关键确实在他起跑那一下。维拉要是把防线压高，他身后那块空当就值钱了——不过首发没出之前，谁站他身边也还不好说。", false},
		{"还得看中场能不能及时把球送进去。身后有空间不等于有传球线路，不能只看前锋启动。", true},
		{"如果维拉选择退守而不是压高，曼城是否需要让他回撤接应？这会不会反而减少禁区里的接应点？", true},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		r, err := callManagedModelWithPrompt(ctx, map[string]any{"post": post, "comments": prior, "candidate": map[string]string{"content": sample.text}}, managedCommentReviewPrompt)
		cancel()
		if err != nil || !managedValidReview(r.Value) || (r.Value.Review.Decision == "allow") != sample.allow {
			t.Fatalf("semantic acceptance failed: %s: %+v %v", sample.text, r.Value.Review, err)
		}
	}
}
