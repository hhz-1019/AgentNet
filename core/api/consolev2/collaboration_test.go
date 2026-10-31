package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/gorm"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCollaborationSQL(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("run collaboration-core-test.mjs")
	}
	db := collaborationFixtureDB(t, dsn)
	s := &Service{db: db}
	version := int64(0)
	pid := ""
	key := 0
	call := func(actor, endpoint, action string, patch func(*collaborationRequest), want int) any {
		t.Helper()
		key++
		r := collaborationRequest{Action: action, ProjectID: pid, ExpectedVersion: version, IdempotencyKey: fmt.Sprintf("key-%d", key)}
		if patch != nil {
			patch(&r)
		}
		result, e := s.collaborationOperation(endpoint, actor, r)
		if want != 200 {
			if e == nil {
				t.Fatalf("%s %s expected %d got success", endpoint, action, want)
			}
			f, ok := e.(*collaborationFailure)
			if !ok || f.status != want {
				t.Fatalf("%s %s: %v", endpoint, action, e)
			}
			return nil
		}
		if e != nil {
			t.Fatalf("%s %s: %v", endpoint, action, e)
		}
		raw, _ := json.Marshal(result)
		var data struct {
			Project collaborationProject
			Version int64
		}
		_ = json.Unmarshal(raw, &data)
		if data.Version > 0 {
			version = data.Version
		}
		if data.Project.ID != "" {
			pid = data.Project.ID
			version = data.Project.Version
		}
		return result
	}
	call("1", "project", "create", func(r *collaborationRequest) { r.Goal = "private research" }, 200)
	initial := version
	call("1", "project", "invite", func(r *collaborationRequest) { r.AgentID = "2"; r.Role = "worker"; r.Scopes = []string{"read", "work"} }, 200)
	call("2", "context", "", nil, 403)
	call("2", "project", "list", nil, 200)
	call("2", "membership", "accept", nil, 200)
	call("2", "context", "", nil, 200)
	call("2", "project", "invite", func(r *collaborationRequest) { r.AgentID = "3"; r.Role = "coordinator"; r.Scopes = collabScopes }, 403)
	task := func(r *collaborationRequest) {
		r.TaskID = "analysis"
		r.Title = "Analyze"
		r.Reviewer = "1"
		r.Assignee = "2"
	}
	call("1", "tasks", "create", task, 200)
	call("1", "tasks", "create", func(r *collaborationRequest) {
		r.TaskID = "draft"
		r.Title = "Draft"
		r.Reviewer = "1"
		r.Assignee = "2"
		r.Dependencies = []string{"analysis"}
	}, 200)
	call("2", "tasks", "accept", func(r *collaborationRequest) { r.TaskID = "draft" }, 200)
	call("2", "tasks", "start", func(r *collaborationRequest) { r.TaskID = "draft"; r.Host = "test-host" }, 409)
	call("2", "tasks", "accept", func(r *collaborationRequest) { r.TaskID = "analysis" }, 200)
	// Two simultaneous host claims use distinct keys and the same project version.
	// PGlite's single-connection fixture queues wire transactions; service calls
	// really overlap, with one authoritative winner and one version conflict.
	start := make(chan struct{})
	out := make(chan error, 2)
	var workers sync.WaitGroup
	for i := 0; i < 2; i++ {
		workers.Add(1)
		go func(i int) {
			defer workers.Done()
			<-start
			_, e := s.collaborationOperation("tasks", "2", collaborationRequest{Action: "start", ProjectID: pid, ExpectedVersion: version, IdempotencyKey: fmt.Sprintf("parallel-start-%d", i), TaskID: "analysis", Host: "test-host"})
			out <- e
		}(i)
	}
	close(start)
	workers.Wait()
	close(out)
	wins, conflicts := 0, 0
	for e := range out {
		if e == nil {
			wins++
		} else if f, ok := e.(*collaborationFailure); ok && f.status == 409 {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("parallel claim wins=%d conflicts=%d", wins, conflicts)
	}
	version++
	call("2", "tasks", "start", func(r *collaborationRequest) { r.TaskID = "analysis"; r.Host = "other-host" }, 409)
	call("2", "tasks", "heartbeat", func(r *collaborationRequest) { r.TaskID = "analysis"; r.Epoch = 0 }, 409)
	// Expire the real stored lease, then recover with explicit side-effect assessment.
	var doc string
	if e := db.Raw(`SELECT document::text FROM collaboration_projects WHERE project_id=?`, pid).Scan(&doc).Error; e != nil {
		t.Fatal(e)
	}
	var p collaborationProject
	_ = json.Unmarshal([]byte(doc), &p)
	p.Tasks["analysis"].LeaseUntil = time.Now().UnixMilli() - 1
	if e := db.Exec(`UPDATE collaboration_projects SET document=?::jsonb WHERE project_id=?`, collabJSON(p), pid).Error; e != nil {
		t.Fatal(e)
	}
	call("2", "submit", "", func(r *collaborationRequest) {
		r.TaskID = "analysis"
		r.Epoch = 1
		r.Artifact = &collaborationArtifact{Kind: "text", Text: "late"}
	}, 409)
	call("2", "tasks", "recover", func(r *collaborationRequest) {
		r.TaskID = "analysis"
		r.Text = "No external changes occurred; safe to restart"
	}, 200)
	call("2", "tasks", "start", func(r *collaborationRequest) { r.TaskID = "analysis"; r.Host = "test-host" }, 200)
	call("2", "tasks", "heartbeat", func(r *collaborationRequest) { r.TaskID = "analysis"; r.Epoch = 1 }, 409)
	submit := func(epoch int64) func(*collaborationRequest) {
		return func(r *collaborationRequest) {
			r.TaskID = "analysis"
			r.Epoch = epoch
			r.Artifact = &collaborationArtifact{Kind: "text", Text: "real bounded result", Verification: "checked"}
		}
	}
	call("2", "submit", "", submit(2), 200)
	call("1", "project", "complete", nil, 409)
	call("1", "review", "changes_requested", func(r *collaborationRequest) { r.TaskID = "analysis"; r.ArtifactVersion = 1; r.Text = "add provenance" }, 200)
	call("2", "tasks", "start", func(r *collaborationRequest) { r.TaskID = "analysis"; r.Host = "test-host" }, 200)
	call("2", "submit", "", submit(3), 200)
	call("1", "review", "accept", func(r *collaborationRequest) { r.TaskID = "analysis"; r.ArtifactVersion = 1 }, 409)
	call("2", "review", "accept", func(r *collaborationRequest) { r.TaskID = "analysis"; r.ArtifactVersion = 2 }, 403)
	call("1", "review", "accept", func(r *collaborationRequest) { r.TaskID = "analysis"; r.ArtifactVersion = 2 }, 200)
	call("2", "tasks", "start", func(r *collaborationRequest) { r.TaskID = "draft"; r.Host = "test-host" }, 200)
	// Replay persists exact response; changed payload and revoked replay both fail.
	saved := collaborationRequest{Action: "publish", ProjectID: pid, ExpectedVersion: version, IdempotencyKey: "durable-key", Text: "finding"}
	if _, e := s.collaborationOperation("updates", "2", saved); e != nil {
		t.Fatal(e)
	}
	version++
	if _, e := s.collaborationOperation("updates", "2", saved); e != nil {
		t.Fatal("replay", e)
	}
	changed := saved
	changed.Text = "changed"
	if _, e := s.collaborationOperation("updates", "2", changed); e == nil {
		t.Fatal("changed key accepted")
	}
	call("1", "updates", "read", nil, 200)
	call("1", "membership", "revoke", func(r *collaborationRequest) { r.AgentID = "2" }, 200)
	call("2", "context", "", nil, 403)
	if _, e := s.collaborationOperation("updates", "2", saved); e == nil {
		t.Fatal("revoked response replay disclosed")
	}
	call("1", "tasks", "cancel", func(r *collaborationRequest) { r.TaskID = "draft" }, 200)
	call("1", "project", "complete", nil, 200)
	if version <= initial {
		t.Fatal("version did not advance")
	}
	var artifacts, reviews, runs, events int64
	for table, dest := range map[string]*int64{"collaboration_artifacts": &artifacts, "collaboration_reviews": &reviews, "collaboration_runs": &runs, "collaboration_events": &events} {
		if e := db.Raw("SELECT count(*) FROM "+table+" WHERE project_id=?", pid).Scan(dest).Error; e != nil {
			t.Fatal(e)
		}
	}
	if artifacts != 2 || reviews != 2 || runs != 4 || events != version {
		t.Fatalf("immutable history counts artifacts=%d reviews=%d runs=%d events=%d version=%d", artifacts, reviews, runs, events, version)
	}
	call("1", "membership", "restrict", func(r *collaborationRequest) { r.Scopes = []string{"read"} }, 200)
	// Independent new project exercises delegated ancestry and current owner binding.
	pid = ""
	version = 0
	call("1", "project", "create", func(r *collaborationRequest) { r.Goal = "delegation" }, 200)
	call("1", "project", "invite", func(r *collaborationRequest) { r.AgentID = "2"; r.Role = "coordinator"; r.Scopes = collabScopes }, 200)
	call("2", "membership", "accept", nil, 200)
	call("2", "project", "invite", func(r *collaborationRequest) { r.AgentID = "3"; r.Role = "worker"; r.Scopes = []string{"read", "work"} }, 200)
	call("3", "membership", "accept", nil, 200)
	call("3", "context", "", nil, 200)
	call("2", "membership", "revoke", nil, 200)
	call("3", "context", "", nil, 403)
	pid = ""
	version = 0
	call("3", "project", "create", func(r *collaborationRequest) { r.Goal = "owner binding" }, 200)
	if e := db.Exec(`UPDATE agent_owners SET owner_uid='changed-owner' WHERE agent_id=3`).Error; e != nil {
		t.Fatal(e)
	}
	call("3", "context", "", nil, 403)
}

func TestCollaborationHTTPContract(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("SQL fixture required")
	}
	s := &Service{db: collaborationFixtureDB(t, dsn)}
	h := server.New()
	h.POST("/project", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(1)); c.Next(ctx) }, s.collaborationHandler("project"))
	for _, body := range []string{`{"action":"create","goal":"x","expected_version":0,"idempotency_key":"http-forged","owner_approved":true}`, `{"action":"create"} {}`} {
		response := ut.PerformRequest(h.Engine, "POST", "/project", &ut.Body{Body: strings.NewReader(body), Len: len(body)})
		if path := os.Getenv("AGENTNET_COLLABORATION_ERROR_FIXTURE"); path != "" {
			if e := os.WriteFile(path, response.Body.Bytes(), 0600); e != nil {
				t.Fatal(e)
			}
		}
		var envelope struct {
			Error struct{ Code, Message string }
		}
		_ = json.Unmarshal(response.Body.Bytes(), &envelope)
		if envelope.Error.Code != "COLLABORATION_INVALID_REQUEST" || envelope.Error.Message == "" {
			t.Fatalf("CLI error.result.error.message contract: %s", response.Body.String())
		}
		if response.Code != 400 {
			t.Fatalf("invalid request accepted: %d %s", response.Code, response.Body.String())
		}
	}
}

func collaborationFixtureDB(t *testing.T, dsn string) *gorm.DB {
	db := socialFixtureDB(t, dsn)
	if os.Getenv("AGENTNET_COLLABORATION_TEST_MULTICONNECTION") == "1" {
		pool, e := db.DB()
		if e != nil {
			t.Fatal(e)
		}
		pool.SetMaxOpenConns(4)
	}
	return db
}

func TestCollaborationDeclineReceipt(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("SQL fixture required")
	}
	s := &Service{db: collaborationFixtureDB(t, dsn)}
	result, e := s.collaborationOperation("project", "1", collaborationRequest{Action: "create", IdempotencyKey: "decline-project", Goal: "TOP-SECRET-DECLINE-GOAL", Requirements: "TOP-SECRET-REQUIREMENTS"})
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(result)
	var data struct{ Project collaborationProject }
	_ = json.Unmarshal(raw, &data)
	pid := data.Project.ID
	_, e = s.collaborationOperation("project", "1", collaborationRequest{Action: "invite", ProjectID: pid, ExpectedVersion: 1, IdempotencyKey: "decline-invite", AgentID: "2", Role: "worker", Scopes: []string{"read", "work"}})
	if e != nil {
		t.Fatal(e)
	}
	h := server.New()
	h.POST("/membership", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(2)); c.Next(ctx) }, s.collaborationHandler("membership"))
	request := collabJSON(collaborationRequest{Action: "decline", ProjectID: pid, ExpectedVersion: 2, IdempotencyKey: "decline-receipt"})
	response := ut.PerformRequest(h.Engine, "POST", "/membership", &ut.Body{Body: strings.NewReader(request), Len: len(request)})
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "TOP-SECRET") || strings.Contains(body, `"project":`) || strings.Contains(body, `"tasks":`) {
		t.Fatal("decline disclosed project", body)
	}
	var stored string
	if e = s.db.Raw(`SELECT response::text FROM collaboration_idempotency WHERE actor=2 AND key='decline-receipt'`).Scan(&stored).Error; e != nil {
		t.Fatal(e)
	}
	if strings.Contains(stored, "TOP-SECRET") || strings.Contains(stored, `"project":`) {
		t.Fatal("sensitive receipt cached", stored)
	}
	replay := ut.PerformRequest(h.Engine, "POST", "/membership", &ut.Body{Body: strings.NewReader(request), Len: len(request)})
	if replay.Code != 403 || strings.Contains(replay.Body.String(), "TOP-SECRET") {
		t.Fatal("declined replay disclosed", replay.Code, replay.Body.String())
	}
}

func TestCollaborationPostLockExpiry(t *testing.T) {
	if os.Getenv("AGENTNET_COLLABORATION_TEST_MULTICONNECTION") != "1" {
		t.Skip("requires isolated real PostgreSQL multi-connection fixture")
	}
	db := collaborationFixtureDB(t, os.Getenv("AGENTNET_COLLABORATION_TEST_DSN"))
	s := &Service{db: db}
	for _, action := range []string{"context", "submit", "heartbeat"} {
		t.Run(action, func(t *testing.T) {
			owner1, e := collabOwner(db, "1")
			if e != nil {
				t.Fatal(e)
			}
			owner2, e := collabOwner(db, "2")
			if e != nil {
				t.Fatal(e)
			}
			deadline := time.Now().UnixMilli() + 700
			pid := collabID()
			p := collaborationProject{ID: pid, Creator: "1", Goal: "held-lock-private", State: "active", Version: 1, Members: map[string]*collaborationMember{}, Tasks: map[string]*collaborationTask{}}
			p.Members["1"] = &collaborationMember{AgentID: "1", OwnerUID: owner1, State: "active", Scopes: collabScopes, Inviter: "1"}
			p.Members["2"] = &collaborationMember{AgentID: "2", OwnerUID: owner2, State: "active", Scopes: []string{"read", "work"}, Inviter: "1"}
			if action == "context" {
				p.Members["2"].ExpiresAt = deadline
			}
			p.Tasks["work"] = &collaborationTask{ID: "work", Assignee: "2", Reviewer: "1", State: "running", Epoch: 1, LeaseUntil: deadline}
			if e = db.Exec(`INSERT INTO collaboration_projects(project_id,creator,document,created_at) VALUES(?,1,?::jsonb,?)`, pid, collabJSON(p), time.Now().UnixMilli()).Error; e != nil {
				t.Fatal(e)
			}
			locked := db.Begin()
			if locked.Error != nil {
				t.Fatal(locked.Error)
			}
			defer locked.Rollback()
			if e = locked.Exec(`SELECT project_id FROM collaboration_projects WHERE project_id=? FOR UPDATE`, pid).Error; e != nil {
				t.Fatal(e)
			}
			endpoint := "tasks"
			r := collaborationRequest{Action: action, ProjectID: pid, TaskID: "work", Epoch: 1, ExpectedVersion: 1, IdempotencyKey: "held-lock-" + pid}
			if action == "context" {
				endpoint = "context"
				r.Action = ""
			}
			if action == "submit" {
				endpoint = "submit"
				r.Action = ""
				r.Artifact = &collaborationArtifact{Kind: "text", Text: "late submission"}
			}
			done := make(chan error, 1)
			go func() { _, err := s.collaborationOperation(endpoint, "2", r); done <- err }()
			// Assert the operation actually reached a PostgreSQL row-lock wait before expiry.
			waiting := false
			for time.Now().UnixMilli() < deadline-50 {
				var n int64
				if e = db.Raw(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%collaboration_projects%'`).Scan(&n).Error; e != nil {
					t.Fatal(e)
				}
				if n > 0 {
					waiting = true
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if !waiting {
				t.Fatal("operation did not reach controlled lock wait before expiry")
			}
			time.Sleep(time.Until(time.UnixMilli(deadline).Add(80 * time.Millisecond)))
			if e = locked.Commit().Error; e != nil {
				t.Fatal(e)
			}
			select {
			case err := <-done:
				f, ok := err.(*collaborationFailure)
				want := 409
				if action == "context" {
					want = 403
				}
				if !ok || f.status != want {
					t.Fatalf("post-lock expired %s accepted: %v", action, err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("operation stuck after lock release")
			}
		})
	}
}
