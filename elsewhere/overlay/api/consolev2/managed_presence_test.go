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

func TestManagedPresenceScopeAndAuthoredPreferences(t *testing.T) {
	if len(managedPresenceSeeds) != 15 {
		t.Fatal("trial must stay at fifteen roles")
	}
	seen := map[int]bool{}
	for _, seed := range managedPresenceSeeds {
		if seed < 0 || seed >= 100 || seen[seed] {
			t.Fatal("invalid trial role", seed)
		}
		seen[seed] = true
		role := managedCatalog()[seed]
		job := managedJob{SeedIndex: &seed, Persona: role.Persona}
		payload := map[string]any{"persona": role.Persona, "angle_hint": "old", "perspective_brief": "old", "writing_brief": "old"}
		managedApplyPresence(payload, job)
		brief, ok := payload["presence_brief"].(managedPresence)
		if !ok || brief.Attention == "" || brief.Preference == "" || brief.Voice == "" || brief.Interaction == "" || payload["persona"] != role.Persona || payload["perspective_brief"] != nil || payload["angle_hint"] != nil || payload["writing_brief"] != nil {
			t.Fatal("trial erased identity or retained conflicting plans", seed, payload)
		}
	}
	seed := 0
	// Edited fields always win; neither the old catalogue nor another role can
	// silently supply missing personality traits.
	job := managedJob{SeedIndex: &seed, PersonaEdited: true, Persona: "【独立观点】偏爱城市声音记录。\n【声音与节奏】简短、平静。"}
	payload := map[string]any{"persona": job.Persona}
	managedApplyPresence(payload, job)
	brief := payload["presence_brief"].(managedPresence)
	if brief.Attention != "" || brief.Preference != "偏爱城市声音记录" || strings.Contains(brief.Voice, "读书") {
		t.Fatal("operator edit overwritten", brief)
	}
	for _, seed := range []int{5, 99, -1, 100} {
		payload = map[string]any{"writing_brief": "untouched"}
		managedApplyPresence(payload, managedJob{SeedIndex: &seed})
		if payload["presence_brief"] != nil || payload["writing_brief"] != "untouched" {
			t.Fatal("trial leaked to other roles", seed)
		}
	}
	if managedPresencePilot(managedJob{}) {
		t.Fatal("unseeded user entered system trial")
	}
}

func TestManagedPresenceModelContractAndInputBound(t *testing.T) {
	t.Setenv("LLM_BASE_URL", "https://presence.fixture.invalid/v1")
	t.Setenv("LLM_MODEL", "fixture")
	t.Setenv("LLM_API_KEY", "fixture-key")
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	requests := 0
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		var input struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		requests++
		if len(input.Messages) != 2 || (requests == 1) != strings.Contains(input.Messages[0].Content, "仅当 presence_brief 非空") {
			t.Fatal("trial prompt selection", requests)
		}
		if requests == 1 && (strings.Contains(input.Messages[0].Content, "社群文风（优先于") || !strings.Contains(input.Messages[0].Content, "writing_card") || !strings.Contains(input.Messages[0].Content, "生活化情境")) {
			t.Fatal("contradictory generic writing policy survived pilot replacement")
		}
		if strings.Contains(input.Messages[1].Content, "old-plan") {
			t.Fatal("conflicting writer cue leaked")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"{\"action\":\"skip\"}"}}],"usage":{"prompt_tokens":500,"completion_tokens":10}}`))}, nil
	})
	seed := 0
	job := managedJob{SeedIndex: &seed, Persona: managedCatalog()[seed].Persona}
	payload := map[string]any{"persona": job.Persona, "perspective_brief": "old-plan"}
	managedApplyPresence(payload, job)
	c := managedContext{PublicEvents: make([]managedPublicEvent, 100)}
	for i := range c.PublicEvents {
		c.PublicEvents[i].Content = strings.Repeat("字", 300)
	}
	if !managedFitInput(payload, &c) || len(c.PublicEvents) >= 100 {
		t.Fatal("unbounded event history")
	}
	raw, _ := managedMarshalInput(payload)
	if len(raw)+len(managedEffectivePrompt(payload, managedPilotPrompt())) > managedMaxInput-1000 {
		t.Fatal("trial prompt omitted from byte budget")
	}
	if _, err := callManagedModel(context.Background(), payload); err != nil {
		t.Fatal(err)
	}
	if _, err := callManagedModel(context.Background(), map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatal("unexpected extra model call", requests)
	}
}

func TestManagedPresencePublicEventBoundaries(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	t.Cleanup(func() { db.Rollback() })
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	for _, id := range []int64{99501, 99502, 99503} {
		check(insertProvisionedAgent(db, id, fmtRun(id)+"@presence.invalid", "记忆测试", 1))
	}
	docBytes, _ := json.Marshal(socialTestDocument())
	doc := string(docBytes)
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES
 (99510,99501,'published',1,'public',?::jsonb,?,?,1),
 (99511,99501,'draft',1,'private',?::jsonb,?,?,NULL),
 (99512,99502,'published',1,'public',?::jsonb,?,?,1),
 (99513,99501,'published',1,'friends',?::jsonb,?,?,1),
 (99514,99501,'published',1,'public',?::jsonb,1,1,1)`, doc, now.UnixMilli(), now.UnixMilli(), doc, now.UnixMilli(), now.UnixMilli(), doc, now.UnixMilli(), now.UnixMilli(), doc, now.UnixMilli(), now.UnixMilli(), doc).Error)
	check(db.Exec(`INSERT INTO social_work_comments(comment_id,post_id,agent_id,content,idempotency_key,created_at,reply_to_comment_id) VALUES
 (99520,99510,99502,'具体的来信问题','presence-incoming',?,NULL),
 (99521,99512,99501,'自己在其他公开帖的回复','presence-own',?,NULL),
 (99522,99512,99502,'对自己回复的接续','presence-followup',?,99521),
 (99523,99512,99503,'无关的其他交流','presence-unrelated',?,NULL),
 (99524,99511,99502,'草稿内不可公开','presence-draft',?,NULL),
 (99525,99513,99502,'好友范围不可公开','presence-friends',?,NULL)`, now.UnixMilli(), now.UnixMilli(), now.UnixMilli(), now.UnixMilli(), now.UnixMilli(), now.UnixMilli()).Error)
	seed := 0
	job := managedJob{AgentID: 99501, SeedIndex: &seed, Action: "post"}
	events, err := managedPublicEvents(db, job, now)
	check(err)
	if len(events) != 4 {
		t.Fatal("private, unrelated, or stale event entered memory", events)
	}
	for _, event := range events {
		if event.ID == "" || event.Date == 0 || event.AuthorID == "" || event.PostID == "" || event.EvidenceScope == "" {
			t.Fatal("event lost provenance", event)
		}
	}
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(99502,99501,2,1)`).Error)
	events, err = managedPublicEvents(db, job, now)
	check(err)
	if len(events) != 1 || events[0].ID != "post:99510" {
		t.Fatal("blocked author or blocked thread entered memory", events)
	}
	check(db.Exec(`UPDATE social_work_posts SET visibility='private' WHERE post_id=99510`).Error)
	events, err = managedPublicEvents(db, job, now)
	check(err)
	if len(events) != 0 {
		t.Fatal("withdrawn public content retained", events)
	}
	// Explicit private rounds return before public-history retrieval, even for
	// the pilot seed, when no authorized private candidate is available.
	job.Action = "message"
	s := &Service{db: db}
	private, err := s.managedContext(context.Background(), job)
	check(err)
	if len(private.PublicEvents) != 0 || len(private.Posts) != 0 || len(private.WritingMemory) != 0 {
		t.Fatal("public history mixed into private round")
	}
}
