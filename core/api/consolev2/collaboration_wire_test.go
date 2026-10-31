package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCollaborationRequestWire(t *testing.T) {
	dir := os.Getenv("AGENTNET_COLLABORATION_WIRE_FIXTURE")
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dir == "" || dsn == "" {
		t.Skip("CLI wire fixture required")
	}
	db := collaborationFixtureDB(t, dsn)
	s := &Service{db: db}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(1)); c.Next(ctx) }
	h.POST("/submit", auth, s.collaborationHandler("submit"))
	h.POST("/context", auth, s.collaborationHandler("context"))
	h.POST("/project", auth, s.collaborationHandler("project"))
	nul := `{"action":"create","goal":"bad\u0000goal","expected_version":0,"idempotency_key":"wire-nul"}`
	invalid := ut.PerformRequest(h.Engine, "POST", "/project", &ut.Body{Body: strings.NewReader(nul), Len: len(nul)})
	if invalid.Code != 400 {
		t.Fatal("NUL reached JSONB storage", invalid.Code, invalid.Body.String())
	}
	for _, sample := range []struct{ name, char string }{{"html", "<"}, {"amp", "&"}, {"control", "\x01"}} {
		t.Run(sample.name, func(t *testing.T) {
			pid := collabID()
			owner, e := collabOwner(db, "1")
			if e != nil {
				t.Fatal(e)
			}
			p := collaborationProject{ID: pid, Creator: "1", State: "active", Version: 1, Members: map[string]*collaborationMember{"1": {AgentID: "1", OwnerUID: owner, State: "active", Scopes: collabScopes, Inviter: "1"}}, Tasks: map[string]*collaborationTask{"WIRE_TASK": {ID: "WIRE_TASK", Assignee: "1", Reviewer: "1", State: "running", Epoch: 1, LeaseUntil: time.Now().Add(time.Minute).UnixMilli()}}}
			if e = db.Exec(`INSERT INTO collaboration_projects(project_id,creator,document,created_at) VALUES(?,1,?::jsonb,1)`, pid, collabJSON(p)).Error; e != nil {
				t.Fatal(e)
			}
			if e = db.Exec(`INSERT INTO collaboration_runs VALUES(?,'WIRE_TASK',1,1,'fixture','running',?)`, pid, time.Now().Add(time.Minute).UnixMilli()).Error; e != nil {
				t.Fatal(e)
			}
			wire, e := os.ReadFile(filepath.Join(dir, sample.name+".json"))
			if e != nil {
				t.Fatal(e)
			}
			wire = bytes.ReplaceAll(wire, []byte("WIRE_PROJECT"), []byte(pid))
			response := ut.PerformRequest(h.Engine, "POST", "/submit", &ut.Body{Body: bytes.NewReader(wire), Len: len(wire)})
			if response.Code != 200 {
				t.Fatalf("actual CLI wire %d bytes rejected: %d %s", len(wire), response.Code, response.Body.String())
			}
			var content string
			if e = db.Raw(`SELECT document::text FROM collaboration_artifacts WHERE project_id=?`, pid).Scan(&content).Error; e != nil {
				t.Fatal(e)
			}
			var artifact collaborationArtifact
			if e := json.Unmarshal([]byte(content), &artifact); e != nil {
				t.Fatal(e)
			}
			if artifact.Text != strings.Repeat(sample.char, 32768) {
				t.Fatal("artifact bytes changed in transport")
			}
			body := []byte(`{"project_id":"` + pid + `"}`)
			body = append(body, bytes.Repeat([]byte(" "), collaborationRequestBytes-len(body))...)
			ok := ut.PerformRequest(h.Engine, "POST", "/context", &ut.Body{Body: bytes.NewReader(body), Len: len(body)})
			if ok.Code != 200 {
				t.Fatal("exact wire cap rejected", ok.Code)
			}
			body = append(body, ' ')
			over := ut.PerformRequest(h.Engine, "POST", "/context", &ut.Body{Body: bytes.NewReader(body), Len: len(body)})
			if over.Code != 400 {
				t.Fatal("first oversized wire byte accepted", over.Code)
			}
		})
	}
}
