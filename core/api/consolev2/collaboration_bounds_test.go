package consolev2

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm/logger"
	"os"
	"strings"
	"testing"
	"time"
)

func collaborationBoundProject(id string) *collaborationProject {
	p := &collaborationProject{ID: id, Goal: "bounded", State: "active", Version: 1, Sequence: 1, Creator: "1", Members: map[string]*collaborationMember{"1": {AgentID: "1", OwnerUID: "independent-owner-A", State: "active", Role: "coordinator", Scopes: collabScopes, Inviter: "1"}}, Tasks: map[string]*collaborationTask{}}
	for i := 0; i < 99; i++ {
		id := fmt.Sprintf("task-%02d", i)
		p.Tasks[id] = &collaborationTask{ID: id, Title: "task", Reviewer: "1", State: "ready", Dependencies: []string{}}
	}
	return p
}

// Fill legal per-task fields to an exact default-escaped aggregate byte size.
func collaborationFillProject(t *testing.T, p *collaborationProject, size int) {
	t.Helper()
	remaining := size - len(collabJSON(p))
	if remaining < 0 {
		t.Fatal("fixture too large")
	}
	for i := 0; i < 99 && remaining > 0; i++ {
		task := p.Tasks[fmt.Sprintf("task-%02d", i)]
		count := min(16000, remaining/6)
		task.Input = strings.Repeat("<", count)
		remaining -= count * 6
		count = min(16000-count, remaining)
		task.Input += strings.Repeat("a", count)
		remaining -= count
	}
	if remaining != 0 || len(collabJSON(p)) != size {
		t.Fatal("cannot construct exact project bound")
	}
}
func TestCollaborationEncodedLimits(t *testing.T) {
	p := collaborationBoundProject("unit")
	collaborationFillProject(t, p, collaborationProjectBytes)
	if e := collabCheckProject(p); e != nil {
		t.Fatal(e)
	}
	p.Goal += "x"
	e := collabCheckProject(p)
	if e == nil || e.(*collaborationFailure).code() != "COLLABORATION_PROJECT_LIMIT" {
		t.Fatal(e)
	}
	p.Goal = strings.TrimSuffix(p.Goal, "x")
	if !strings.Contains(collabJSON(p), `\u003c`) {
		t.Fatal("default escaping not measured")
	}
	projects := make([]any, 20)
	for i := range projects {
		projects[i] = p
	}
	result := map[string]any{"projects": projects, "next_cursor": 20, "has_more": true}
	if e := collabCheckResult(result); e != nil {
		t.Fatal(e)
	}
	compact, _ := json.Marshal(result)
	pretty, _ := json.MarshalIndent(result, "", "  ")
	if len(compact) < 2<<20 || len(pretty)+1 > collaborationCLIBytes {
		t.Fatal("invalid multi-project transport fixture")
	}
	exact := map[string]any{"text": ""}
	base, _ := json.Marshal(map[string]any{"data": exact})
	exact["text"] = strings.Repeat("a", collaborationResultBytes-len(base))
	if e := collabCheckResult(exact); e != nil {
		t.Fatal(e)
	}
	exact["text"] = exact["text"].(string) + "x"
	if e := collabCheckResult(exact); e == nil || e.(*collaborationFailure).code() != "COLLABORATION_RESULT_LIMIT" {
		t.Fatal(e)
	}
}
func TestCollaborationBoundRollbackSQL(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("SQL fixture required")
	}
	db := collaborationFixtureDB(t, dsn)
	db.Logger = db.Logger.LogMode(logger.Silent)
	s := &Service{db: db}
	p := collaborationBoundProject("bounded-rollback")
	collaborationFillProject(t, p, collaborationProjectBytes-500)
	if e := db.Exec(`INSERT INTO collaboration_projects(project_id,creator,document,version,sequence,created_at) VALUES(?,?,?::jsonb,?,?,?)`, p.ID, "1", collabJSON(p), p.Version, p.Sequence, time.Now().UnixMilli()).Error; e != nil {
		t.Fatal(e)
	}
	before := collabJSON(p)
	r := collaborationRequest{Action: "create", ProjectID: p.ID, TaskID: "too-large", Title: "oversized", Input: strings.Repeat("<", 16000), Reviewer: "1", ExpectedVersion: 1, IdempotencyKey: "bounded-reusable"}
	_, e := s.collaborationOperation("tasks", "1", r)
	if e == nil || e.(*collaborationFailure).code() != "COLLABORATION_PROJECT_LIMIT" {
		t.Fatal(e)
	}
	var row struct {
		Document          string
		Version, Sequence int64
	}
	db.Raw(`SELECT document::text,version,sequence FROM collaboration_projects WHERE project_id=?`, p.ID).Scan(&row)
	var stored collaborationProject
	json.Unmarshal([]byte(row.Document), &stored)
	if collabJSON(stored) != before || row.Version != 1 || row.Sequence != 1 {
		t.Fatal("failed mutation changed project")
	}
	for _, table := range []string{"collaboration_events", "collaboration_idempotency", "collaboration_artifacts"} {
		var count int64
		db.Table(table).Where("project_id=?", p.ID).Count(&count)
		if count != 0 {
			t.Fatalf("failed mutation persisted %s", table)
		}
	}
	// Same key is still available because the oversized mutation did not commit it.
	r.Input = "small"
	if _, e = s.collaborationOperation("tasks", "1", r); e != nil {
		t.Fatal(e)
	}
	// Simulate oversized legacy state and verify submit's prior artifact/run writes rollback.
	p = collaborationBoundProject("bounded-submit")
	task := p.Tasks["task-00"]
	task.State = "running"
	task.Assignee = "1"
	task.Epoch = 1
	task.LeaseUntil = time.Now().Add(time.Minute).UnixMilli()
	collaborationFillProject(t, p, collaborationProjectBytes+100)
	if e = db.Exec(`INSERT INTO collaboration_projects(project_id,creator,document,version,sequence,created_at) VALUES(?,?,?::jsonb,?,?,?)`, p.ID, "1", collabJSON(p), 1, 1, time.Now().UnixMilli()).Error; e != nil {
		t.Fatal(e)
	}
	if e = db.Exec(`INSERT INTO collaboration_runs(project_id,task_id,epoch,actor,host,status,lease_until) VALUES(?,?,?,?,?,?,?)`, p.ID, task.ID, 1, "1", "fixture", "running", task.LeaseUntil).Error; e != nil {
		t.Fatal(e)
	}
	_, e = s.collaborationOperation("submit", "1", collaborationRequest{ProjectID: p.ID, TaskID: task.ID, Epoch: 1, ExpectedVersion: 1, IdempotencyKey: "bounded-submit-key", Artifact: &collaborationArtifact{Kind: "text", Text: "actual result", Provenance: "fixture", Verification: "checks"}})
	if e == nil || e.(*collaborationFailure).code() != "COLLABORATION_PROJECT_LIMIT" {
		t.Fatal(e)
	}
	var count int64
	db.Table("collaboration_artifacts").Where("project_id=?", p.ID).Count(&count)
	if count != 0 {
		t.Fatal("artifact survived aggregate rollback")
	}
	var run struct {
		Status     string
		LeaseUntil int64
	}
	db.Raw(`SELECT status,lease_until FROM collaboration_runs WHERE project_id=?`, p.ID).Scan(&run)
	if run.Status != "running" || run.LeaseUntil != task.LeaseUntil {
		t.Fatal("run survived rollback")
	}
	for _, table := range []string{"collaboration_events", "collaboration_idempotency"} {
		var n int64
		db.Table(table).Where("project_id=?", p.ID).Count(&n)
		if n != 0 {
			t.Fatalf("submit rollback persisted %s", table)
		}
	}
	db.Raw("SELECT document::text,version,sequence FROM collaboration_projects WHERE project_id=?", p.ID).Scan(&row)
	if row.Version != 1 || row.Sequence != 1 {
		t.Fatal("submit rollback changed version")
	}
	json.Unmarshal([]byte(row.Document), &stored)
	if stored.Tasks[task.ID].State != "running" || stored.Tasks[task.ID].ArtifactVersion != 0 {
		t.Fatal("submit rollback changed task")
	}
	// Oversized read results fail explicitly; they are never truncated or cached as a success.
	huge := strings.Repeat("<", collaborationResultBytes/6+10)
	if e = db.Exec(`INSERT INTO collaboration_events VALUES(?,?,?,?::jsonb,?)`, p.ID, 1, "1", collabJSON(map[string]any{"text": huge}), time.Now().UnixMilli()).Error; e != nil {
		t.Fatal(e)
	}
	_, e = s.collaborationOperation("updates", "1", collaborationRequest{Action: "read", ProjectID: p.ID})
	if e == nil || e.(*collaborationFailure).code() != "COLLABORATION_RESULT_LIMIT" {
		t.Fatal(e)
	}
}
