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

func TestManagedCelebrityActivity(t *testing.T) {
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
	now := time.Now()
	ctx := context.Background()
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('celebrity-activity',987654219,'!x','!x',1)`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654219")
	s := &Service{db: db, idgen: &managedTestIDs{id: 39700000}}
	p := celebrityCatalog()[0]
	ids, err := s.provisionManagedEntries(ctx, "celebrity-activity", map[int]managedPersona{20000: celebrityPersona(p)})
	check(err)
	id := ids[0]
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true,monthly_budget_fen=10000,input_fen_per_million=1,output_fen_per_million=1,dm_reply_enabled=true,dm_start_enabled=true WHERE sponsor_uid='celebrity-activity'`).Error)
	check(db.Exec(`UPDATE managed_members SET enabled=true,daily_limit=4,start_hour=0,end_hour=24,next_run_at=0 WHERE agent_id=?`, id).Error)
	check(db.Exec(`UPDATE agent_settings SET auto_reply_pm=true,auto_start_pm=true WHERE agent_id=?`, id).Error)
	job, err := s.claimManaged(ctx, now)
	check(err)
	if job == nil || job.AgentID != id || job.Action != "" || job.Topic != "" {
		t.Fatal("autonomous wake assigned a topic", job)
	}
	// A source failure must not suppress independently collected original posts.
	originals, _ := json.Marshal([]managedSource{{Title: "One concrete detail", Summary: "A public observation", URL: "https://example.com/original", Kind: "self_post", Published: now.UTC().Format(time.RFC3339)}})
	check(db.Exec(`INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id,checked_at,originals) VALUES('celebrity-activity',?,'celebrity',?,0,?::jsonb)`, p.Key, id, string(originals)).Error)
	sources, err := s.celebritySources(ctx, *job)
	check(err)
	if len(sources) != 1 || sources[0].Kind != "self_post" {
		t.Fatal("stale news erased original samples", sources)
	}
	doc := `{"title":"制造成本中的一个具体问题","summary":"讨论产量变化时哪些成本值得分别观察","body":"假设一条产线提高速度后，返工也变多了。我会先把每件合格品的材料损耗单独列出来，再看设备利用率。更快的节拍可能降低固定成本分摊，却未必让合格品更便宜。这两个变化需要分别观察。","kind":"question","tags":["制造"]}`
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(39790000,?,'published',1,'public',?::jsonb,?,?,1)`, id, doc, now.UnixMilli(), now.UnixMilli()).Error)
	progress, err := s.dailyPublishingProgress(id, 10, now)
	check(err)
	if progress.Published != 1 || progress.RemainingToMinimum != 4 {
		t.Fatal(progress)
	}
	progress, err = s.dailyPublishingProgress(id, 10, now.Add(25*time.Hour))
	check(err)
	if progress.Published != 0 || progress.RemainingToMinimum != 5 {
		t.Fatal(progress)
	}
	// Incoming mail wakes a celebrity ahead of its next scheduled public turn.
	check(insertProvisionedAgent(db, 39790001, "celebrity-peer@fixture.invalid", "交流对象", now.UnixMilli()))
	check(db.Exec(`UPDATE managed_runs SET status='skipped',charged_fen=0 WHERE run_id=?`, job.RunID).Error)
	lo, hi := id, int64(39790001)
	if lo > hi {
		lo, hi = hi, lo
	}
	check(db.Exec(`INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,origin_type,origin_id,updated_at,topic_status) VALUES(39790002,?,?,39790001,39790001,'direct',0,?,1);
INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(39790003,39790002,39790001,?,'如何区分材料损耗与设备利用率带来的成本变化？',?)`, lo, hi, now.UnixMilli(), id, now.UnixMilli()).Error)
	reply, err := s.claimManagedMode(ctx, now.Add(time.Second), true)
	check(err)
	if reply == nil || reply.AgentID != id || reply.Action != "message" {
		t.Fatal("celebrity reply not prioritized", reply)
	}
	input, err := s.managedContext(ctx, *reply)
	check(err)
	if !input.Targets.Private || input.Message == nil || input.Message.ReplyToMessageID != "39790003" || len(input.Posts) != 0 {
		t.Fatal("private reply not isolated")
	}
	// Several older originals must not crowd newer news out of a recent-activity
	// reply. Private reading must not consume the public publication quota.
	older := []managedSource{}
	for i := 0; i < 4; i++ {
		older = append(older, managedSource{Title: "Older original", URL: "https://example.com/older", Kind: "self_post", Published: now.Add(-48 * time.Hour).UTC().Format(time.RFC3339)})
	}
	originals, _ = json.Marshal(older)
	news, _ := json.Marshal([]managedSource{{Title: "RECENT_ACTIVITY_FIXTURE", Summary: "A recent public update", URL: "https://example.com/recent", Kind: "news", Published: now.Add(-time.Hour).UTC().Format(time.RFC3339)}})
	check(db.Exec(`UPDATE managed_public_sources SET originals=?::jsonb,items=?::jsonb,checked_at=? WHERE agent_id=?`, string(originals), string(news), now.UnixMilli(), id).Error)
	t.Setenv("LLM_BASE_URL", "https://api.deepseek.com")
	t.Setenv("LLM_MODEL", "fixture-model")
	t.Setenv("LLM_API_KEY", "fixture-key")
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	called := false
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		called = true
		var wire struct {
			Messages []struct{ Role, Content string }
		}
		check(json.NewDecoder(r.Body).Decode(&wire))
		var payload struct {
			Sources        []managedSource `json:"web_sources"`
			RequiredAction string          `json:"required_action"`
		}
		check(json.Unmarshal([]byte(wire.Messages[1].Content), &payload))
		if payload.RequiredAction != "message" || len(payload.Sources) == 0 || payload.Sources[0].Title != "RECENT_ACTIVITY_FIXTURE" {
			t.Fatal("private reply missing latest public evidence", payload)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"{\"action\":\"skip\"}"}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}`))}, nil
	})
	s.executeManaged(ctx, *reply)
	if !called {
		t.Fatal("private generation not exercised")
	}
	var sourceKey string
	check(db.Raw(`SELECT source_key FROM managed_runs WHERE run_id=?`, reply.RunID).Scan(&sourceKey).Error)
	if sourceKey != "" {
		t.Fatal("private reading reserved public source quota")
	}
	check(db.Exec(`UPDATE managed_runs SET status='skipped',charged_fen=0 WHERE run_id=?`, reply.RunID).Error)
	check(db.Exec(`UPDATE managed_campaigns SET enabled=false WHERE sponsor_uid='celebrity-activity'`).Error)
	paused, err := s.claimManagedMode(ctx, now.Add(2*time.Second), true)
	check(err)
	if paused != nil {
		t.Fatal("campaign pause bypassed")
	}
}

func TestManagedCelebrityPromptBudget(t *testing.T) {
	payload := map[string]any{"celebrity_profile": celebrityCatalog()[0], "persona": celebrityPersona(celebrityCatalog()[0]).Persona}
	base, _ := json.Marshal(payload)
	// Leave room for the required profile and system rules; force only optional
	// history over budget instead of assuming a fixed-size system prompt.
	padding := managedMaxInput - 3000 - len(base) - len(managedPrompt) - len(celebrityWritingPrompt) - len(celebrityIdentityPrompt)
	if padding < 0 {
		t.Fatal("required celebrity context exceeds budget")
	}
	payload["persona"] = payload["persona"].(string) + strings.Repeat("a", padding)
	c := managedContext{Recent: []managedPostHistory{{Body: strings.Repeat("b", 15000)}}}
	if !managedFitInput(payload, &c) {
		t.Fatal("could not reduce optional history")
	}
	raw, _ := json.Marshal(payload)
	if len(raw)+len(managedPrompt)+len(celebrityWritingPrompt)+len(celebrityIdentityPrompt) > managedMaxInput-1000 {
		t.Fatal("celebrity system instructions not budgeted")
	}
}

func TestManagedCelebrityPublicRoundInput(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	ctx := context.Background()
	now := time.Now()
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('celebrity-public-input',987654299,'!x','!x',1)`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654299")
	s := &Service{db: db, idgen: &managedTestIDs{id: 39880000}}
	p := celebrityCatalog()[0]
	ids, e := s.provisionManagedEntries(ctx, "celebrity-public-input", map[int]managedPersona{20000: celebrityPersona(p)})
	check(e)
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true WHERE sponsor_uid='celebrity-public-input'; UPDATE managed_members SET enabled=true,next_run_at=0 WHERE sponsor_uid='celebrity-public-input'`).Error)
	job, e := s.claimManaged(ctx, now)
	check(e)
	if job == nil {
		t.Fatal("missing admitted job")
	}
	check(db.Exec(`INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id) VALUES('celebrity-public-input',?,'celebrity',?)`, p.Key, ids[0]).Error)
	t.Setenv("LLM_BASE_URL", "https://api.deepseek.com")
	t.Setenv("LLM_MODEL", "fixture-model")
	t.Setenv("LLM_API_KEY", "fixture-key")
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	calls := 0
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var wire struct {
			Messages []struct{ Role, Content string }
		}
		check(json.NewDecoder(r.Body).Decode(&wire))
		t.Logf("public wire bytes: system=%d data=%d", len(wire.Messages[0].Content), len(wire.Messages[1].Content))
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"{\"action\":\"skip\"}"}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}`))}, nil
	})
	// A real public round has existing posts, unlike a newly seeded empty account.
	doc, _ := json.Marshal(map[string]any{"title": "公开材料中的一个具体问题", "summary": "核对公开资料的条件与边界", "body": strings.Repeat("公开材料需要结合具体条件理解。", 20), "kind": "question", "tags": []string{"讨论"}})
	check(insertProvisionedAgent(db, 39879999, "public-input-peer@fixture.invalid", "公开讨论者", now.UnixMilli()))
	check(db.Exec("INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING", 39879999, "celebrity-public-input", now.UnixMilli()).Error)
	for i := 0; i < 6; i++ {
		author := ids[0]
		if i%2 == 0 {
			author = 39879999
		}
		check(db.Exec("INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,'published',1,'public',?::jsonb,?,?,1)", 39879900+i, author, string(doc), now.UnixMilli(), now.UnixMilli()).Error)
	}
	check(db.Exec("INSERT INTO agent_activity_reviews(agent_id,revision,day,intent,summary,evidence,updated_at) VALUES(?,1,CURRENT_DATE,'跟进公开进展',?,'[]'::jsonb,?)", ids[0], strings.Repeat("核对公开资料的条件与后续进展。", 15), now.UnixMilli()).Error)
	s.executeManaged(ctx, *job)
	var run struct{ Status, Detail string }
	check(db.Raw(`SELECT status,detail FROM managed_runs WHERE run_id=?`, job.RunID).Scan(&run).Error)
	if calls == 0 || strings.Contains(run.Detail, "[input]") {
		t.Fatalf("public celebrity input blocked: calls=%d status=%s detail=%s", calls, run.Status, run.Detail)
	}
}
