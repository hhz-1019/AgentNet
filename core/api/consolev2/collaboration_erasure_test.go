package consolev2

import (
	"encoding/json"
	"gorm.io/gorm"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCollaborationAccountErasure(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("SQL fixture")
	}
	db := collaborationFixtureDB(t, dsn)
	ids := []int64{99101, 99102, 99103, 99104, 99105}
	for _, id := range ids {
		if e := db.Exec(`INSERT INTO agents(agent_id,identity_state) VALUES(?,'active')`, id).Error; e != nil {
			t.Fatal(e)
		}
		if e := db.Exec(`INSERT INTO agent_owners(agent_id,owner_uid) VALUES(?,?)`, id, "owner-"+strconv.FormatInt(id, 10)).Error; e != nil {
			t.Fatal(e)
		}
	}
	member := func(id int64, inviter string) *collaborationMember {
		return &collaborationMember{AgentID: strconv.FormatInt(id, 10), OwnerUID: "owner-" + strconv.FormatInt(id, 10), State: "active", Scopes: collabScopes, Inviter: inviter}
	}
	creator, departed, child, invitee, reviewer := strconv.FormatInt(ids[0], 10), strconv.FormatInt(ids[1], 10), strconv.FormatInt(ids[2], 10), strconv.FormatInt(ids[3], 10), strconv.FormatInt(ids[4], 10)
	shared := collaborationProject{ID: collabID(), Goal: "SURVIVOR-GOAL", Creator: creator, State: "active", Version: 5, Sequence: 4, Members: map[string]*collaborationMember{}, Tasks: map[string]*collaborationTask{}}
	shared.Members[creator] = member(ids[0], creator)
	shared.Members[departed] = member(ids[1], creator)
	shared.Members[child] = member(ids[2], departed)
	shared.Members[invitee] = member(ids[3], creator)
	shared.Members[invitee].State = "invited"
	shared.Members[reviewer] = member(ids[4], creator)
	shared.Tasks["private-task"] = &collaborationTask{ID: "private-task", Title: "DEPARTED-TASK-TEXT", Input: "DEPARTED-INPUT", Output: "DEPARTED-OUTPUT", Assignee: departed, Reviewer: reviewer, State: "submitted", Epoch: 1, ArtifactVersion: 1}
	shared.Tasks["survivor-task"] = &collaborationTask{ID: "survivor-task", Title: "SURVIVOR-TASK", Assignee: creator, Reviewer: creator, State: "accepted_result", ArtifactVersion: 1}
	shared.Tasks["delegated"] = &collaborationTask{ID: "delegated", Title: "CHILD-TASK", Assignee: child, Reviewer: creator, State: "running", Epoch: 1}
	shared.Tasks["reviewed-task"] = &collaborationTask{ID: "reviewed-task", Title: "SURVIVOR-REVIEW-INPUT", Assignee: creator, Reviewer: departed, State: "submitted"}
	insertProject := func(p collaborationProject) {
		t.Helper()
		if e := db.Exec(`INSERT INTO collaboration_projects(project_id,creator,version,sequence,document,created_at) VALUES(?,?,?,?,?::jsonb,?)`, p.ID, p.Creator, p.Version, p.Sequence, collabJSON(p), time.Now().UnixMilli()).Error; e != nil {
			t.Fatal(e)
		}
	}
	insertProject(shared)
	unrelated := collaborationProject{ID: collabID(), Creator: child, Goal: "UNRELATED-GOAL", State: "active", Version: 1, Members: map[string]*collaborationMember{child: member(ids[2], child)}, Tasks: map[string]*collaborationTask{}}
	insertProject(unrelated)
	own := shared
	own.ID = collabID()
	own.Creator = departed
	own.Members = map[string]*collaborationMember{departed: member(ids[1], departed)}
	insertProject(own)
	for _, pid := range []string{shared.ID, own.ID} {
		for _, a := range []struct{ task, actor, text string }{{"private-task", departed, "DEPARTED-ARTIFACT"}, {"survivor-task", creator, "SURVIVOR-ARTIFACT"}} {
			artifact := collaborationArtifact{TaskID: a.task, Version: 1, Submitter: a.actor, Kind: "text", Text: a.text, Provenance: a.text, Verification: a.text}
			if e := db.Exec(`INSERT INTO collaboration_artifacts VALUES(?,?,1,?::jsonb)`, pid, a.task, collabJSON(artifact)).Error; e != nil {
				t.Fatal(e)
			}
		}
		for _, a := range []struct{ task, actor string }{{"private-task", departed}, {"delegated", child}} {
			host := "SURVIVOR-HOST"
			if a.actor == departed {
				host = "DEPARTED-HOST"
			}
			if e := db.Exec(`INSERT INTO collaboration_runs VALUES(?,?,1,?,?,'running',?)`, pid, a.task, a.actor, host, time.Now().Add(time.Minute).UnixMilli()).Error; e != nil {
				t.Fatal(e)
			}
		}
		if e := db.Exec(`INSERT INTO collaboration_reviews VALUES(?,'private-task',1,?,'changes_requested','DEPARTED-REVIEW',1)`, pid, departed).Error; e != nil {
			t.Fatal(e)
		}
		for seq, actor := range []string{creator, departed, creator, departed} {
			action := "publish"
			endpoint := "updates"
			if seq == 1 {
				endpoint = "tasks"
				action = "create"
			}
			doc := map[string]any{"endpoint": endpoint, "action": action, "task_id": "private-task", "text": "DEPARTED-EVENT"}
			if actor == creator {
				doc["text"] = "SURVIVOR-EVENT"
			}
			if e := db.Exec(`INSERT INTO collaboration_events VALUES(?,?,?,?::jsonb,1)`, pid, seq+1, actor, collabJSON(doc)).Error; e != nil {
				t.Fatal(e)
			}
		}
		for _, actor := range []string{creator, departed} {
			if e := db.Exec(`INSERT INTO collaboration_idempotency VALUES(?,?,?,'hash',?::jsonb)`, actor, "erasure-"+pid, pid, collabJSON(shared)).Error; e != nil {
				t.Fatal(e)
			}
		}
	}
	erase := func(id int64) {
		t.Helper()
		if e := db.Transaction(func(tx *gorm.DB) error {
			if e := eraseCollaboration(tx, []int64{id}); e != nil {
				return e
			}
			if e := tx.Exec(`DELETE FROM agent_owners WHERE agent_id=?`, id).Error; e != nil {
				return e
			}
			return tx.Exec(`DELETE FROM agents WHERE agent_id=?`, id).Error
		}); e != nil {
			t.Fatal("physical deletion failed", e)
		}
	}
	erase(ids[1])
	var p collaborationProject
	var raw string
	if e := db.Raw(`SELECT document::text FROM collaboration_projects WHERE project_id=?`, shared.ID).Scan(&raw).Error; e != nil {
		t.Fatal(e)
	}
	if e := json.Unmarshal([]byte(raw), &p); e != nil {
		t.Fatal(e)
	}
	if p.Goal != "SURVIVOR-GOAL" || p.Tasks["survivor-task"].Title != "SURVIVOR-TASK" || p.Members[creator] == nil {
		t.Fatal("survivor data lost")
	}
	if p.Members[departed] != nil || p.Members[child].State != "revoked" || p.Members[child].Inviter != "" || p.Tasks["private-task"].State != "cancelled" || p.Tasks["delegated"].State != "cancelled" || strings.Contains(raw, "DEPARTED-") {
		t.Fatal("departed data or execution retained", raw)
	}
	if p.Tasks["reviewed-task"].Reviewer != "" || p.Tasks["reviewed-task"].State != "cancelled" || p.Tasks["reviewed-task"].Title != "SURVIVOR-REVIEW-INPUT" {
		t.Fatal("departing reviewer retained or survivor input lost")
	}
	var survivorArtifact string
	if e := db.Raw(`SELECT document->>'text' FROM collaboration_artifacts WHERE project_id=? AND task_id='survivor-task'`, shared.ID).Scan(&survivorArtifact).Error; e != nil {
		t.Fatal(e)
	}
	if survivorArtifact != "SURVIVOR-ARTIFACT" {
		t.Fatal("survivor artifact lost")
	}
	if _, e := (&Service{db: db}).collaborationOperation("context", child, collaborationRequest{ProjectID: shared.ID}); e == nil {
		t.Fatal("erased delegation descendant retained read")
	}
	if _, e := (&Service{db: db}).collaborationOperation("updates", creator, collaborationRequest{Action: "read", ProjectID: shared.ID}); e != nil {
		t.Fatal("survivor cannot consume contiguous tombstoned events", e)
	}
	for _, table := range []string{"collaboration_projects", "collaboration_idempotency", "collaboration_artifacts", "collaboration_reviews", "collaboration_runs", "collaboration_events"} {
		var n int64
		if e := db.Raw("SELECT count(*) FROM "+table+" WHERE project_id=?", own.ID).Scan(&n).Error; e != nil {
			t.Fatal(e)
		}
		if n != 0 {
			t.Fatal("creator project retained", table)
		}
	}
	var cache int64
	db.Raw(`SELECT count(*) FROM collaboration_idempotency WHERE project_id=?`, shared.ID).Scan(&cache)
	if cache != 1 {
		t.Fatal("survivor idempotency key lost", cache)
	}
	var cachedResponse string
	db.Raw(`SELECT response::text FROM collaboration_idempotency WHERE project_id=?`, shared.ID).Scan(&cachedResponse)
	if strings.Contains(cachedResponse, "SURVIVOR-") || strings.Contains(cachedResponse, departed) || !strings.Contains(cachedResponse, "erased_receipt") {
		t.Fatal("sensitive snapshot retained", cachedResponse)
	}
	var events []struct {
		Sequence int64
		Actor    *int64
		Document string
	}
	if e := db.Raw(`SELECT sequence,actor,document::text FROM collaboration_events WHERE project_id=? ORDER BY sequence`, shared.ID).Scan(&events).Error; e != nil {
		t.Fatal(e)
	}
	if len(events) != 5 {
		t.Fatal("cleanup event missing", len(events))
	}
	for i, event := range events {
		if event.Sequence != int64(i+1) || strings.Contains(event.Document, "DEPARTED-EVENT") {
			t.Fatal("event gap or departed body", event)
		}
		if (i == 1 || i == 3) && event.Actor != nil {
			t.Fatal("departed event actor retained")
		}
	}
	for _, query := range []string{`SELECT document::text FROM collaboration_artifacts WHERE project_id=?`, `SELECT COALESCE(reviewer::text,'')||reason FROM collaboration_reviews WHERE project_id=?`, `SELECT COALESCE(actor::text,'')||host FROM collaboration_runs WHERE project_id=?`} {
		var values []string
		if e := db.Raw(query, shared.ID).Scan(&values).Error; e != nil {
			t.Fatal(e)
		}
		for _, value := range values {
			if strings.Contains(value, departed) || strings.Contains(value, "DEPARTED-") {
				t.Fatal("departed history retained", value)
			}
		}
	}
	// Invited-only identity is erased despite never creating a relational actor FK.
	erase(ids[3])
	var doc string
	db.Raw(`SELECT document::text FROM collaboration_projects WHERE project_id=?`, shared.ID).Scan(&doc)
	if strings.Contains(doc, "owner-"+invitee) || strings.Contains(doc, `"`+invitee+`"`) {
		t.Fatal("invited-only identity retained", doc)
	}
	// Creator erasure removes all owned history, releasing every collaboration FK.
	erase(ids[0])
	var count int64
	db.Raw(`SELECT count(*) FROM collaboration_projects WHERE project_id=?`, shared.ID).Scan(&count)
	if count != 0 {
		t.Fatal("creator project survived")
	}
	var preserved string
	if e := db.Raw(`SELECT document::text FROM collaboration_projects WHERE project_id=?`, unrelated.ID).Scan(&preserved).Error; e != nil {
		t.Fatal(e)
	}
	if preserved != collabJSON(unrelated) {
		var parsed collaborationProject
		_ = json.Unmarshal([]byte(preserved), &parsed)
		if parsed.Version != 1 || parsed.Goal != "UNRELATED-GOAL" {
			t.Fatal("unrelated owner project changed", preserved)
		}
	}
}

func TestCollaborationErasedReceiptSQL(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("SQL fixture")
	}
	db := collaborationFixtureDB(t, dsn)
	s := &Service{db: db}
	const departed int64 = 99106
	if _, e := collabOwner(db, "099106"); e == nil {
		t.Fatal("noncanonical Agent alias accepted")
	}
	if e := db.Exec(`INSERT INTO agents(agent_id,identity_state) VALUES(?,'active')`, departed).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec(`INSERT INTO agent_owners VALUES(?,'ERASED-RECEIPT-OWNER')`, departed).Error; e != nil {
		t.Fatal(e)
	}
	request := collaborationRequest{Action: "create", Goal: "SURVIVING-IDEMPOTENT-PROJECT", IdempotencyKey: "erased-create-retry"}
	result, e := s.collaborationOperation("project", "1", request)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(result)
	var data struct{ Project collaborationProject }
	if e = json.Unmarshal(raw, &data); e != nil {
		t.Fatal(e)
	}
	if _, e = s.collaborationOperation("project", "1", collaborationRequest{Action: "invite", ProjectID: data.Project.ID, ExpectedVersion: 1, IdempotencyKey: "erased-invite-retry", AgentID: "99106", Role: "worker", Scopes: []string{"read"}}); e != nil {
		t.Fatal(e)
	}
	if e = db.Transaction(func(tx *gorm.DB) error {
		if err := eraseCollaboration(tx, []int64{departed}); err != nil {
			return err
		}
		if err := tx.Exec(`DELETE FROM agent_owners WHERE agent_id=?`, departed).Error; err != nil {
			return err
		}
		return tx.Exec(`DELETE FROM agents WHERE agent_id=?`, departed).Error
	}); e != nil {
		t.Fatal(e)
	}
	var before, after int64
	db.Raw(`SELECT count(*) FROM collaboration_projects`).Scan(&before)
	if _, e = s.collaborationOperation("project", "1", request); e == nil {
		t.Fatal("erased create retry reexecuted")
	} else if f, ok := e.(*collaborationFailure); !ok || f.code() != "COLLABORATION_RECEIPT_ERASED" {
		t.Fatal("missing erased-receipt conflict", e)
	}
	request.Goal = "changed"
	if _, e = s.collaborationOperation("project", "1", request); e == nil {
		t.Fatal("changed key accepted")
	} else if f, ok := e.(*collaborationFailure); !ok || f.code() != "COLLABORATION_KEY_CONFLICT" {
		t.Fatal("changed payload lost conflict", e)
	}
	db.Raw(`SELECT count(*) FROM collaboration_projects`).Scan(&after)
	if before != after {
		t.Fatal("duplicate project allocated", before, after)
	}
	var tombstones []string
	if e = db.Raw(`SELECT response::text FROM collaboration_idempotency WHERE project_id=?`, data.Project.ID).Scan(&tombstones).Error; e != nil {
		t.Fatal(e)
	}
	for _, tombstone := range tombstones {
		if strings.Contains(tombstone, "ERASED-RECEIPT") || strings.Contains(tombstone, "99106") || !strings.Contains(tombstone, "erased_receipt") {
			t.Fatal("sensitive snapshot retained", tombstone)
		}
	}
}

func TestCollaborationErasureInviteRace(t *testing.T) {
	if os.Getenv("AGENTNET_COLLABORATION_TEST_MULTICONNECTION") != "1" {
		t.Skip("real PostgreSQL multi-connection only")
	}
	db := collaborationFixtureDB(t, os.Getenv("AGENTNET_COLLABORATION_TEST_DSN"))
	s := &Service{db: db}
	const departed int64 = 99107
	if e := db.Exec(`INSERT INTO agents(agent_id,identity_state) VALUES(?,'active')`, departed).Error; e != nil {
		t.Fatal(e)
	}
	if e := db.Exec(`INSERT INTO agent_owners VALUES(?,'RACE-DEPARTED-OWNER')`, departed).Error; e != nil {
		t.Fatal(e)
	}
	deletion := db.Begin()
	if deletion.Error != nil {
		t.Fatal(deletion.Error)
	}
	defer deletion.Rollback()
	if e := eraseCollaboration(deletion, []int64{departed}); e != nil {
		t.Fatal(e)
	} // scan has finished, transaction remains uncommitted
	// A project inserted after that snapshot is not covered by project row locks.
	result, e := s.collaborationOperation("project", "1", collaborationRequest{Action: "create", Goal: "post-scan project", IdempotencyKey: "post-erasure-scan-project"})
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(result)
	var data struct{ Project collaborationProject }
	if e = json.Unmarshal(raw, &data); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() {
		_, err := s.collaborationOperation("project", "1", collaborationRequest{Action: "invite", ProjectID: data.Project.ID, ExpectedVersion: 1, IdempotencyKey: "post-scan-invite", AgentID: "99107", Role: "worker", Scopes: []string{"read"}})
		done <- err
	}()
	waiting := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var n int64
		if e = db.Raw(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM agents WHERE agent_id IN%'`).Scan(&n).Error; e != nil {
			t.Fatal(e)
		}
		if n > 0 {
			waiting = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("invitation did not wait on departing target before project lock")
	}
	if e = deletion.Exec(`DELETE FROM agent_owners WHERE agent_id=?`, departed).Error; e != nil {
		t.Fatal(e)
	}
	if e = deletion.Exec(`DELETE FROM agents WHERE agent_id=?`, departed).Error; e != nil {
		t.Fatal(e)
	}
	if e = deletion.Commit().Error; e != nil {
		t.Fatal(e)
	}
	select {
	case err := <-done:
		if f, ok := err.(*collaborationFailure); !ok || f.status != 403 {
			t.Fatal("invitation to deleted target accepted", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("target lock cycle after erasure commit")
	}
	var project string
	db.Raw(`SELECT document::text FROM collaboration_projects WHERE project_id=?`, data.Project.ID).Scan(&project)
	if strings.Contains(project, "99107") || strings.Contains(project, "RACE-DEPARTED-OWNER") {
		t.Fatal("new project retained deleted target", project)
	}
	var caches []string
	db.Raw(`SELECT response::text FROM collaboration_idempotency WHERE project_id=?`, data.Project.ID).Scan(&caches)
	for _, cache := range caches {
		if strings.Contains(cache, "99107") || strings.Contains(cache, "RACE-DEPARTED-OWNER") {
			t.Fatal("new snapshot retained deleted target", cache)
		}
	}
}

func TestCollaborationReciprocalInviteLocks(t *testing.T) {
	if os.Getenv("AGENTNET_COLLABORATION_TEST_MULTICONNECTION") != "1" {
		t.Skip("real PostgreSQL multi-connection only")
	}
	db := collaborationFixtureDB(t, os.Getenv("AGENTNET_COLLABORATION_TEST_DSN"))
	s := &Service{db: db}
	actors := []string{"99108", "99109"}
	projects := []string{}
	for _, actor := range actors {
		if e := db.Exec(`INSERT INTO agents(agent_id,identity_state) VALUES(?,'active')`, actor).Error; e != nil {
			t.Fatal(e)
		}
		if e := db.Exec(`INSERT INTO agent_owners VALUES(?,?)`, actor, "reciprocal-"+actor).Error; e != nil {
			t.Fatal(e)
		}
		result, e := s.collaborationOperation("project", actor, collaborationRequest{Action: "create", Goal: "reciprocal lock proof", IdempotencyKey: "reciprocal-create"})
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(result)
		var data struct{ Project collaborationProject }
		if e = json.Unmarshal(raw, &data); e != nil {
			t.Fatal(e)
		}
		projects = append(projects, data.Project.ID)
	}
	gate := make(chan struct{})
	done := make(chan error, 2)
	for index, actor := range actors {
		go func(index int, actor string) {
			<-gate
			_, e := s.collaborationOperation("project", actor, collaborationRequest{Action: "invite", ProjectID: projects[index], ExpectedVersion: 1, IdempotencyKey: "reciprocal-invite", AgentID: actors[1-index], Role: "worker", Scopes: []string{"read"}})
			done <- e
		}(index, actor)
	}
	close(gate)
	for range actors {
		select {
		case e := <-done:
			if e != nil {
				t.Fatal("reciprocal invitation failed", e)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("reciprocal actor/target lock order cycle")
		}
	}
}
