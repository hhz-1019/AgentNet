package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

// Opt-in paid model + real shared handlers, with all writes rolled back in an
// isolated database. This is platform-adapter acceptance, not every-host proof.
func TestManagedActivityRealProvider(t *testing.T) {
	if os.Getenv("AGENTNET_ACTIVITY_LIVE") != "true" {
		t.Skip("explicit provider acceptance required")
	}
	if !managedModelConfigured() {
		t.Fatal("provider unavailable")
	}
	transport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = transport })
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		res, e := transport.RoundTrip(r)
		if e == nil {
			raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			res.Body.Close()
			res.Body = io.NopCloser(bytes.NewReader(raw))
			var response struct {
				Choices []struct{ Message struct{ Content string } }
			}
			_ = json.Unmarshal(raw, &response)
			if len(response.Choices) > 0 {
				t.Logf("isolated model decision: %s", response.Choices[0].Message.Content)
			} else {
				t.Logf("provider status=%d", res.StatusCode)
			}
		}
		return res, e
	})
	db := socialFixtureDB(t, os.Getenv("AGENTNET_MANAGED_TEST_DSN")).Begin()
	defer db.Rollback()
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('activity-live',987654228,'!x','!x',1)`).Error)
	s := &Service{db: db, idgen: &managedTestIDs{id: 369800000001000000}}
	role := managedCatalog()[0]
	ids, e := s.provisionManagedEntries(context.Background(), "activity-live", map[int]managedPersona{0: role})
	check(e)
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true,monthly_budget_fen=10000,input_fen_per_million=1,output_fen_per_million=1 WHERE sponsor_uid='activity-live'; UPDATE managed_members SET enabled=true,start_hour=0,end_hour=24 WHERE sponsor_uid='activity-live'`).Error)
	seed := 0
	job := managedJob{AgentID: ids[0], SponsorUID: "activity-live", Name: role.Name, Persona: role.Persona, Scenario: role.Scenario, SeedIndex: &seed, Revision: 1, RunID: 369800000001009999, InputRate: 1, OutputRate: 1, Reserved: 1}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,?,?,'2026-10-17','2026-10','running',1,1,?)`, job.RunID, job.AgentID, job.SponsorUID, time.Now().UnixMilli()).Error)
	input := managedContext{Targets: managedTargets{Enforced: true, Comments: map[int64]bool{}, Likes: map[int64]bool{}}}
	payload := map[string]any{"agent_identity": job.identitySnapshot(), "name": job.Name, "character_brief": job.characterBrief(), "context": input, "operator_topic": "这是隔离验收中的假设讨论材料，不是真实活动新闻：学校读书会允许旁听，但报名表要求每位参加者先提交一个问题。先用 observations 查看是否有补充材料，再围绕这两条规则可能产生的张力自主提出一个具体问题或观点。请使用 publish 工具分享，读回帖子核验，然后留下待续事项。不要编造参加经历或实际主办方。"}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	result, e := s.managedActivityModel(ctx, &job, payload, &input)
	check(e)
	check(s.commitManaged(ctx, job, result, nil))
	s.managedActivityCheckpoint(ctx, job, result)
	var posts []struct {
		PostID   int64
		Document string
	}
	check(db.Raw("SELECT post_id,document::text FROM social_work_posts WHERE agent_id=? AND state='published'", job.AgentID).Scan(&posts).Error)
	if len(posts) == 0 || result.Calls < 3 {
		t.Fatalf("no verified multi-step publication: posts=%d calls=%d action=%s pending=%s", len(posts), result.Calls, result.Value.Action, result.Value.Pending)
	}
	var reads int64
	check(db.Raw("SELECT count(*) FROM agent_activity_receipts WHERE agent_id=? AND tool='publish'", job.AgentID).Scan(&reads).Error)
	if reads == 0 {
		t.Fatal("publication did not use common tool")
	}
	t.Logf("platform real-provider calls=%d public_posts=%d document=%s", result.Calls, len(posts), posts[0].Document)
}
