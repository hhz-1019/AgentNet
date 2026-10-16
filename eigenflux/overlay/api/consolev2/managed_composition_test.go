package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagedCompositionEvidenceAndIsolation(t *testing.T) {
	for _, v := range []managedOutput{{Action: "review", Review: managedReview{Decision: "allow", Reason: "unknown"}}, {Action: "review", Review: managedReview{Decision: "rewrite", Reason: "ok"}}, {Action: "post", Review: managedReview{Decision: "allow", Reason: "ok"}}} {
		if managedValidReview(v) {
			t.Fatal("invalid review accepted", v)
		}
	}
	if !managedValidReview(managedOutput{Action: "review", Review: managedReview{Decision: "rewrite", Reason: "duplicate_structure"}}) {
		t.Fatal("valid structural rejection refused")
	}
	seed := 0
	job := managedJob{SeedIndex: &seed}
	c := managedContext{Mine: []managedPostHistory{{Body: "旧的生活故事不能作为下一次亲历"}}, PublicEvents: []managedPublicEvent{{Kind: "own_post", Content: "不能升级为真实履历"}, {Kind: "received_comment", Content: "请解释这一步"}}, WritingMemory: []managedWritingMemory{{Card: managedWritingCard{Focus: "已经讨论的具体对象"}}}}
	writer := managedPresenceWriterContext(c, job)
	if writer.Mine[0].Body != "" || writer.PublicEvents[0].Content != "" || writer.PublicEvents[1].Content != "请解释这一步" || c.Mine[0].Body == "" || c.PublicEvents[0].Content == "" {
		t.Fatal("expression memory leaked prose, lost actual reply or mutated context")
	}
	private := c
	private.Targets.Private = true
	if managedPresenceWriterContext(private, job).Mine[0].Body == "" {
		t.Fatal("private conversation path altered")
	}
	p := map[string]any{"context": c, "web_sources": []managedSource{{ID: "source:1"}}}
	for _, grounding := range []string{"platform_record", "source", "verified", "illustration", "view"} {
		card := managedBoundWritingCard(managedWritingCard{Focus: strings.Repeat("字", 200), Grounding: grounding, EvidenceIDs: []string{"made-up", "source:1", "source:1"}}, p)
		if utfCount(card.Focus) > 80 {
			t.Fatal("unbounded writing card")
		}
		if grounding == "source" && (len(card.EvidenceIDs) != 1 || card.EvidenceIDs[0] != "source:1") {
			t.Fatal("source IDs not bound", card)
		}
		if (grounding == "verified" || grounding == "platform_record") && card.Grounding != "unverified_expression" {
			t.Fatal("invented evidence trusted", card)
		}
		if (grounding == "illustration" || grounding == "view") && len(card.EvidenceIDs) != 0 {
			t.Fatal("fiction inherited evidence", card)
		}
	}
	p = map[string]any{"required_action": "message"}
	managedApplyPresence(p, job)
	if p["presence_brief"] != nil {
		t.Fatal("public composition policy entered private task")
	}
	p = map[string]any{"context": private}
	managedApplyPresence(p, job)
	if p["presence_brief"] != nil {
		t.Fatal("public policy entered automatic private round")
	}
	trace := managedWritingTrace{Version: "presence-v2", Attempts: []managedWritingAttempt{{Draft: socialDocument{Body: `本机配置位于 C:\Users\Alice\secret.txt`}}}}
	if managedTraceJSON(trace) != "{}" {
		t.Fatal("private path retained in diagnostics")
	}
}

func TestManagedCompositionPublicMemoryAndDiagnostics(t *testing.T) {
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
	ms := now.UnixMilli()
	for _, id := range []int64{99601, 99602} {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@composition.invalid", "构思验收", ms))
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('composition-sponsor',987654230,'!x','!x',1),('composition-a',987654231,'!x','!x',1),('composition-b',987654232,'!x','!x',1);
 INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million) VALUES('composition-sponsor',true,10000,200,800);
 INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled,start_hour,end_hour,daily_limit) VALUES(99601,'composition-a','composition-sponsor',0,'甲','学习互助','测试',true,0,24,12),(99602,'composition-b','composition-sponsor',1,'乙','学习互助','测试',true,0,24,12);`).Error)
	local := now.UTC().Add(8 * time.Hour)
	doc := socialTestDocument()
	doc.Title = "已有的生活情境"
	raw, _ := json.Marshal(doc)
	for i := 0; i < 12; i++ {
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,99601,'published',1,'public',?::jsonb,?,?,1)`, 99610+i, string(raw), ms-int64(i+1)*1000, ms-int64(i+1)*1000).Error)
	}
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(99630,99602,'published',1,'public',?::jsonb,?,?,1)`, string(raw), ms, ms).Error)
	trace := managedWritingTrace{Version: "presence-v2", Attempts: []managedWritingAttempt{{Card: managedWritingCard{Intent: "说一个偏好", Focus: "桌游的准备过程", Movement: "期待后因为等待而退缩", Point: "不想先上课", Grounding: "illustration"}, Draft: doc, Decision: "allow", Reason: "ok"}}}
	check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at,post_id,writing_trace) VALUES(996001,99601,'composition-sponsor',?::date,?,'published',1,1,?,99610,?::jsonb)`, local.Format("2006-01-02"), local.Format("2006-01"), ms, managedTraceJSON(trace)).Error)
	seed := 0
	job := managedJob{AgentID: 99601, SponsorUID: "composition-sponsor", SeedIndex: &seed, Scenario: "学习互助"}
	memory, err := managedWritingMemories(db, job, now)
	check(err)
	if len(memory) != 9 || memory[0].Card.Grounding != "illustration" || memory[0].EvidenceScope == "" {
		t.Fatal("memory quota or provenance lost", memory)
	}
	for _, m := range memory {
		if m.PostID != "99610" && m.Card.Grounding != "unverified_expression" {
			t.Fatal("legacy story promoted to fact", m)
		}
	}
	check(db.Exec(`UPDATE social_work_posts SET visibility='private' WHERE post_id=99610`).Error)
	memory, err = managedWritingMemories(db, job, now)
	check(err)
	for _, m := range memory {
		if m.PostID == "99610" {
			t.Fatal("withdrawn story retained")
		}
	}
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(99602,99601,2,1)`).Error)
	memory, err = managedWritingMemories(db, job, now)
	check(err)
	for _, m := range memory {
		if !m.Own {
			t.Fatal("blocked author entered composition memory")
		}
	}
	// Reviewer must retain own history even under a busy community feed.
	service := &Service{db: db}
	for i := 0; i < 165; i++ {
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,99602,'published',1,'public',?::jsonb,?,?,1)`, 99700+i, string(raw), ms+int64(i), ms+int64(i)).Error)
	}
	check(db.Exec(`DELETE FROM user_relations WHERE from_uid=99602 AND to_uid=99601`).Error)
	history, err := service.managedReviewHistory(context.Background(), job, "完全不同的内容")
	check(err)
	own := 0
	for _, h := range history {
		if h.AuthorID == "99601" {
			own++
		}
	}
	if own != 6 || len(history) > 24 {
		t.Fatal("own history crowded out of reviewer", own, len(history))
	}
}
