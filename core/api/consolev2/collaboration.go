package consolev2

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

const collaborationRequestBytes = 512 << 10
const collaborationProjectBytes = 256 << 10
const collaborationResultBytes = 8 << 20
const collaborationCLIBytes = 16 << 20

// Marshal with Go's default escaping: '<', '>' and '&' consume six bytes each.
func collabCheckProject(project *collaborationProject) error {
	encoded, err := json.Marshal(project)
	if err != nil {
		return err
	}
	if len(encoded) > collaborationProjectBytes {
		return collabFail(400, "project exceeds 256 KiB; split the work into smaller projects")
	}
	return nil
}
func collabCheckResult(result any) error {
	encoded, err := json.Marshal(map[string]any{"data": result})
	if err != nil {
		return err
	}
	if len(encoded) > collaborationResultBytes {
		return collabFail(400, "collaboration result exceeds 8 MiB; reduce the project or page content")
	}
	// CLI emits the unwrapped data using two-space indentation plus a newline.
	pretty, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if len(pretty)+1 > collaborationCLIBytes {
		return collabFail(400, "collaboration result exceeds 8 MiB; reduce the project or page content")
	}
	return nil
}

// All capability grants are project-local delegation by an authenticated Agent.
// They are never represented as owner consent or host execution authorization.
type collaborationMember struct {
	AgentID   string   `json:"agent_id"`
	OwnerUID  string   `json:"owner_uid"`
	State     string   `json:"state"`
	Role      string   `json:"role"`
	Scopes    []string `json:"scopes"`
	ExpiresAt int64    `json:"expires_at"`
	Inviter   string   `json:"inviter"`
}
type collaborationTask struct {
	ID              string   `json:"task_id"`
	Title           string   `json:"title"`
	Input           string   `json:"input"`
	Output          string   `json:"output"`
	Assignee        string   `json:"assignee"`
	Reviewer        string   `json:"reviewer"`
	Dependencies    []string `json:"dependencies"`
	State           string   `json:"state"`
	Epoch           int64    `json:"epoch"`
	LeaseUntil      int64    `json:"lease_until"`
	ArtifactVersion int64    `json:"artifact_version"`
}
type collaborationProject struct {
	ID           string                          `json:"project_id"`
	Goal         string                          `json:"goal"`
	Requirements string                          `json:"requirements"`
	State        string                          `json:"state"`
	Version      int64                           `json:"version"`
	Sequence     int64                           `json:"sequence"`
	Creator      string                          `json:"creator"`
	Members      map[string]*collaborationMember `json:"members"`
	Tasks        map[string]*collaborationTask   `json:"tasks"`
}
type collaborationArtifact struct {
	TaskID       string `json:"task_id"`
	Version      int64  `json:"version"`
	Submitter    string `json:"submitter"`
	Kind         string `json:"kind"`
	Text         string `json:"text,omitempty"`
	URI          string `json:"uri,omitempty"`
	Digest       string `json:"digest"`
	Provenance   string `json:"provenance"`
	Verification string `json:"verification"`
}
type collaborationRequest struct {
	Action          string                 `json:"action"`
	ProjectID       string                 `json:"project_id"`
	IdempotencyKey  string                 `json:"idempotency_key"`
	ExpectedVersion int64                  `json:"expected_version"`
	AgentID         string                 `json:"agent_id"`
	Goal            string                 `json:"goal"`
	Requirements    string                 `json:"requirements"`
	Role            string                 `json:"role"`
	Scopes          []string               `json:"scopes"`
	ExpiresAt       int64                  `json:"expires_at"`
	TaskID          string                 `json:"task_id"`
	Title           string                 `json:"title"`
	Input           string                 `json:"input"`
	Output          string                 `json:"output"`
	Assignee        string                 `json:"assignee"`
	Reviewer        string                 `json:"reviewer"`
	Dependencies    []string               `json:"dependencies"`
	Host            string                 `json:"host"`
	Epoch           int64                  `json:"epoch"`
	ArtifactVersion int64                  `json:"artifact_version"`
	Artifact        *collaborationArtifact `json:"artifact"`
	Text            string                 `json:"text"`
	Cursor          int64                  `json:"cursor"`
}
type collaborationFailure struct {
	status  int
	message string
}

func (e *collaborationFailure) Error() string     { return e.message }
func collabFail(status int, message string) error { return &collaborationFailure{status, message} }
func collabJSON(v any) string                     { b, _ := json.Marshal(v); return string(b) }
func collabID() string                            { var b [16]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func collabContains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

var collabScopes = []string{"read", "work", "coordinate", "review", "invite"}

func collabMember(p *collaborationProject, id string, now int64) *collaborationMember {
	m := p.Members[id]
	if m == nil || m.State != "active" || (m.ExpiresAt > 0 && m.ExpiresAt <= now) {
		return nil
	}
	return m
}
func collabHas(p *collaborationProject, id, scope string, now int64) bool {
	m := collabMember(p, id, now)
	return m != nil && collabContains(m.Scopes, scope)
}
func collabOwner(tx *gorm.DB, id string) (string, error) {
	n, e := strconv.ParseInt(id, 10, 64)
	if e != nil || n <= 0 || strconv.FormatInt(n, 10) != id {
		return "", collabFail(400, "invalid agent")
	}
	var row struct{ OwnerUID string }
	e = tx.Raw(`SELECT o.owner_uid FROM agent_owners o JOIN agents a USING(agent_id) WHERE o.agent_id=? AND a.identity_state='active'`, n).Scan(&row).Error
	if e != nil {
		return "", e
	}
	if row.OwnerUID == "" {
		return "", collabFail(403, "active owned Agent required")
	}
	return row.OwnerUID, nil
}
func (s *Service) collaborationHandler(endpoint string) app.HandlerFunc {
	return func(_ context.Context, c *app.RequestContext) {
		id, ok := agentID(c)
		if !ok {
			fail(c, 401, "AGENT_AUTH_REQUIRED", "authentication required", nil)
			return
		}
		var r collaborationRequest
		decoder := json.NewDecoder(bytes.NewReader(c.Request.Body()))
		decoder.DisallowUnknownFields()
		if len(c.Request.Body()) > collaborationRequestBytes || decoder.Decode(&r) != nil {
			fail(c, 400, "COLLABORATION_INVALID_REQUEST", "invalid collaboration request", nil)
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			fail(c, 400, "COLLABORATION_INVALID_REQUEST", "invalid collaboration request", nil)
			return
		}
		result, err := s.collaborationOperation(endpoint, strconv.FormatInt(id, 10), r)
		if err != nil {
			var f *collaborationFailure
			if errors.As(err, &f) {
				fail(c, f.status, f.code(), f.message, nil)
			} else {
				fail(c, 500, "COLLABORATION_UNAVAILABLE", "collaboration temporarily unavailable", nil)
			}
			return
		}
		reply(c, 200, result)
	}
}
func (s *Service) collaborationOperation(endpoint, actor string, r collaborationRequest) (any, error) {
	// Event pages are bounded too, including fields irrelevant to a mutation.
	if len(r.Text) > 8000 || len(r.TaskID) > 128 {
		return nil, collabFail(400, "invalid collaboration event fields")
	}
	if !collabValidStrings(reflect.ValueOf(r)) {
		return nil, collabFail(400, "U+0000 is not supported in collaboration text")
	}
	var result any
	err := s.db.Transaction(func(tx *gorm.DB) (operationErr error) {
		// This deferred guard executes before transaction commit, including replay/read paths.
		// Any result-limit failure rolls back state, immutable history and idempotency together.
		defer func() {
			if operationErr == nil {
				operationErr = collabCheckResult(result)
			}
		}()
		now := time.Now().UnixMilli()
		if _, e := collabOwner(tx, actor); e != nil {
			return e
		}
		read := (endpoint == "project" && (r.Action == "list" || r.Action == "get")) || (endpoint == "tasks" && (r.Action == "list" || r.Action == "get")) || endpoint == "context" || (endpoint == "updates" && r.Action == "read")
		canonical := collabJSON(struct {
			Endpoint string
			Request  collaborationRequest
		}{endpoint, r})
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(canonical)))
		if !read && (len(r.IdempotencyKey) < 1 || len(r.IdempotencyKey) > 128) {
			return collabFail(400, "idempotency_key required")
		}
		// Lock every identity that can acquire a new reference before project locks.
		// Numeric order matches account erasure and prevents reciprocal invites
		// from taking actor/target locks in opposite orders.
		if !read {
			actorID, _ := strconv.ParseInt(actor, 10, 64)
			identities := []int64{actorID}
			if endpoint == "project" && r.Action == "invite" {
				target, e := strconv.ParseInt(r.AgentID, 10, 64)
				if e != nil || target <= 0 {
					return collabFail(400, "invalid agent")
				}
				identities = append(identities, target)
			}
			if e := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id IN ? ORDER BY agent_id FOR UPDATE`, identities).Error; e != nil {
				return e
			}
			if _, e := collabOwner(tx, actor); e != nil {
				return e
			}
			if endpoint == "project" && r.Action == "invite" {
				if _, e := collabOwner(tx, r.AgentID); e != nil {
					return e
				}
			}
		}
		if endpoint == "project" && r.Action == "list" {
			if r.Cursor < 0 {
				return collabFail(400, "invalid cursor")
			}
			var rows []struct{ Document string }
			if e := tx.Raw(`SELECT document::text FROM collaboration_projects WHERE jsonb_exists(document->'members',?) ORDER BY created_at,project_id LIMIT 20 OFFSET ?`, actor, r.Cursor).Scan(&rows).Error; e != nil {
				return e
			}
			items := []any{}
			for _, row := range rows {
				now = time.Now().UnixMilli()
				var p collaborationProject
				if e := json.Unmarshal([]byte(row.Document), &p); e != nil {
					return e
				}
				now = time.Now().UnixMilli() // authoritative time after actor/project lock waits
				if e := collabRefreshGrants(tx, &p, now); e != nil {
					return e
				}
				if collabHas(&p, actor, "read", now) {
					items = append(items, p)
				} else if m := p.Members[actor]; m != nil && m.State == "invited" && (m.ExpiresAt == 0 || m.ExpiresAt > now) {
					items = append(items, map[string]any{"project_id": p.ID, "version": p.Version, "offer": m})
				}
			}
			result = map[string]any{"projects": items, "next_cursor": r.Cursor + int64(len(rows)), "has_more": len(rows) == 20}
			return nil
		}
		var p collaborationProject
		if endpoint == "project" && r.Action == "create" {
			// Replay creation by actor/key before allocating a fresh project ID.
			var old struct{ ProjectID string }
			if e := tx.Raw(`SELECT project_id FROM collaboration_idempotency WHERE actor=? AND key=?`, actor, r.IdempotencyKey).Scan(&old).Error; e != nil {
				return e
			}
			r.ProjectID = old.ProjectID
			if r.ProjectID == "" {
				if r.ExpectedVersion != 0 || strings.TrimSpace(r.Goal) == "" || len(r.Goal) > 8000 || len(r.Requirements) > 16000 {
					return collabFail(400, "invalid project")
				}
				owner, e := collabOwner(tx, actor)
				if e != nil {
					return e
				}
				p = collaborationProject{ID: collabID(), Goal: r.Goal, Requirements: r.Requirements, State: "active", Creator: actor, Members: map[string]*collaborationMember{}, Tasks: map[string]*collaborationTask{}}
				p.Members[actor] = &collaborationMember{AgentID: actor, OwnerUID: owner, State: "active", Role: "coordinator", Scopes: append([]string{}, collabScopes...), Inviter: actor}
				if e = tx.Exec(`INSERT INTO collaboration_projects(project_id,creator,document,created_at) VALUES(?,?,?::jsonb,?)`, p.ID, actor, collabJSON(p), now).Error; e != nil {
					return e
				}
			}
		}
		if p.ID == "" {
			var row struct {
				Document          string
				Version, Sequence int64
			}
			if e := tx.Raw(`SELECT document::text,version,sequence FROM collaboration_projects WHERE project_id=? FOR UPDATE`, r.ProjectID).Scan(&row).Error; e != nil {
				return e
			}
			if row.Document == "" {
				return collabFail(404, "project unavailable")
			}
			if e := json.Unmarshal([]byte(row.Document), &p); e != nil {
				return e
			}
			p.Version = row.Version
			p.Sequence = row.Sequence
		}
		now = time.Now().UnixMilli() // authoritative time after actor/project lock waits
		if e := collabRefreshGrants(tx, &p, now); e != nil {
			return e
		}
		member := p.Members[actor]
		invitation := endpoint == "membership" && (r.Action == "accept" || r.Action == "decline") && member != nil && member.State == "invited" && (member.ExpiresAt == 0 || member.ExpiresAt > now)
		if !collabHas(&p, actor, "read", now) && !invitation {
			return collabFail(403, "project access denied")
		}
		if !read {
			var old struct{ RequestHash, Response, ProjectID string }
			if e := tx.Raw(`SELECT request_hash,response::text,project_id FROM collaboration_idempotency WHERE actor=? AND key=?`, actor, r.IdempotencyKey).Scan(&old).Error; e != nil {
				return e
			}
			if old.RequestHash != "" {
				if old.RequestHash != hash || old.ProjectID != p.ID {
					return collabFail(409, "idempotency key payload conflict")
				}
				var receipt struct {
					Erased bool `json:"erased_receipt"`
				}
				if e := json.Unmarshal([]byte(old.Response), &receipt); e != nil {
					return e
				}
				if receipt.Erased {
					return collabFail(409, "idempotency receipt erased")
				}
				return json.Unmarshal([]byte(old.Response), &result)
			}
			if r.ExpectedVersion != p.Version {
				return collabFail(409, "project version conflict")
			}
			if p.State != "active" && !(endpoint == "membership" && (r.Action == "revoke" || r.Action == "restrict")) {
				return collabFail(409, "project is complete")
			}
		}
		if read {
			switch endpoint {
			case "project":
				result = map[string]any{"project": p}
			case "tasks":
				if r.Action == "get" {
					t := p.Tasks[r.TaskID]
					if t == nil {
						return collabFail(404, "task unavailable")
					}
					result = map[string]any{"task": t, "version": p.Version}
				} else {
					result = map[string]any{"tasks": p.Tasks, "version": p.Version}
				}
			case "context":
				if r.Cursor < 0 {
					return collabFail(400, "invalid cursor")
				}
				artifacts := []json.RawMessage{}
				var rows []struct{ Document string }
				if e := tx.Raw(`SELECT document::text FROM collaboration_artifacts WHERE project_id=? ORDER BY task_id,version LIMIT 20 OFFSET ?`, p.ID, r.Cursor).Scan(&rows).Error; e != nil {
					return e
				}
				for _, row := range rows {
					now = time.Now().UnixMilli()
					artifacts = append(artifacts, json.RawMessage(row.Document))
				}
				result = map[string]any{"project": p, "artifacts": artifacts, "next_cursor": r.Cursor + int64(len(rows)), "has_more": len(rows) == 20, "execution_mode": "host_session_only", "grant_basis": "authenticated_agent_delegation"}
			case "updates":
				if r.Cursor < 0 {
					return collabFail(400, "invalid cursor")
				}
				var rows []struct {
					Sequence  int64           `json:"sequence"`
					Actor     string          `json:"actor"`
					Document  json.RawMessage `json:"document"`
					CreatedAt int64           `json:"created_at"`
				}
				if e := tx.Raw(`SELECT sequence,actor::text,document,created_at FROM collaboration_events WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT 100`, p.ID, r.Cursor).Scan(&rows).Error; e != nil {
					return e
				}
				cursor := r.Cursor
				if len(rows) > 0 {
					cursor = rows[len(rows)-1].Sequence
				}
				result = map[string]any{"events": rows, "next_cursor": cursor, "version": p.Version}
			}
			return nil
		}
		if e := collabTransition(tx, &p, actor, endpoint, r, now); e != nil {
			return e
		}
		p.Version++
		p.Sequence++
		if e := collabCheckProject(&p); e != nil {
			return e
		}
		event := map[string]any{"event_id": p.ID + ":" + strconv.FormatInt(p.Sequence, 10), "endpoint": endpoint, "action": r.Action, "task_id": r.TaskID, "version": p.Version, "text": r.Text}
		if e := tx.Exec(`UPDATE collaboration_projects SET document=?::jsonb,version=?,sequence=? WHERE project_id=?`, collabJSON(p), p.Version, p.Sequence, p.ID).Error; e != nil {
			return e
		}
		if e := tx.Exec(`INSERT INTO collaboration_events VALUES(?,?,?,?::jsonb,?)`, p.ID, p.Sequence, actor, collabJSON(event), now).Error; e != nil {
			return e
		}
		if endpoint == "membership" && (r.Action == "decline" || r.Action == "revoke" || r.Action == "restrict") {
			target := r.AgentID
			if target == "" {
				target = actor
			}
			m := p.Members[target]
			result = map[string]any{"project_id": p.ID, "version": p.Version, "membership": map[string]any{"agent_id": target, "state": m.State, "scopes": m.Scopes, "expires_at": m.ExpiresAt}, "event": event}
		} else if collabHas(&p, actor, "read", time.Now().UnixMilli()) {
			result = map[string]any{"project": p, "event": event}
		} else {
			return collabFail(403, "project access denied")
		}
		return tx.Exec(`INSERT INTO collaboration_idempotency VALUES(?,?,?,?,?::jsonb)`, actor, r.IdempotencyKey, p.ID, hash, collabJSON(result)).Error
	})
	return result, err
}

func collabTransition(tx *gorm.DB, p *collaborationProject, actor, endpoint string, r collaborationRequest, now int64) error {
	require := func(scope string) error {
		if !collabHas(p, actor, scope, now) {
			return collabFail(403, "scope denied")
		}
		return nil
	}
	switch endpoint {
	case "project":
		switch r.Action {
		case "create":
			return nil
		case "invite":
			if len(p.Members) >= 100 {
				return collabFail(409, "project member limit reached")
			}
			if e := require("invite"); e != nil {
				return e
			}
			if r.AgentID == actor || p.Members[r.AgentID] != nil {
				return collabFail(409, "membership already exists")
			}
			if r.Role != "worker" && r.Role != "reviewer" && r.Role != "coordinator" {
				return collabFail(400, "invalid role")
			}
			if !collabContains(r.Scopes, "read") || len(r.Scopes) > 5 || r.ExpiresAt < 0 || (r.ExpiresAt > 0 && r.ExpiresAt <= now) {
				return collabFail(400, "invalid grant")
			}
			own := p.Members[actor]
			if own.ExpiresAt > 0 && (r.ExpiresAt == 0 || r.ExpiresAt > own.ExpiresAt) {
				return collabFail(403, "grant exceeds delegator expiry")
			}
			seen := map[string]bool{}
			for _, scope := range r.Scopes {
				if seen[scope] || !collabContains(collabScopes, scope) || !collabContains(own.Scopes, scope) {
					return collabFail(403, "grant exceeds delegator scopes")
				}
				seen[scope] = true
			}
			uid, e := collabOwner(tx, r.AgentID)
			if e != nil {
				return e
			}
			p.Members[r.AgentID] = &collaborationMember{AgentID: r.AgentID, OwnerUID: uid, State: "invited", Role: r.Role, Scopes: r.Scopes, ExpiresAt: r.ExpiresAt, Inviter: actor}
			return nil
		case "complete":
			if actor != p.Creator {
				return collabFail(403, "creator required")
			}
			if len(p.Tasks) == 0 {
				return collabFail(409, "accepted tasks required")
			}
			accepted := false
			for _, t := range p.Tasks {
				if t.State == "accepted_result" {
					accepted = true
				}
				if t.State != "accepted_result" && t.State != "cancelled" {
					return collabFail(409, "tasks remain unaccepted")
				}
			}
			if !accepted {
				return collabFail(409, "accepted tasks required")
			}
			p.State = "completed"
			return nil
		}
	case "membership":
		target := r.AgentID
		if target == "" {
			target = actor
		}
		m := p.Members[target]
		if m == nil {
			return collabFail(404, "membership unavailable")
		}
		switch r.Action {
		case "accept", "decline":
			if target != actor || m.State != "invited" {
				return collabFail(409, "invitation unavailable")
			}
			if r.Action == "accept" {
				m.State = "active"
			} else {
				m.State = "declined"
			}
			return nil
		case "restrict":
			if target != actor || m.State != "active" || !collabContains(r.Scopes, "read") {
				return collabFail(403, "self restriction required")
			}
			for _, scope := range r.Scopes {
				if !collabContains(m.Scopes, scope) {
					return collabFail(403, "grant expansion denied")
				}
			}
			if r.ExpiresAt < 0 || (m.ExpiresAt > 0 && (r.ExpiresAt == 0 || r.ExpiresAt > m.ExpiresAt)) {
				return collabFail(403, "expiry expansion denied")
			}
			m.Scopes = r.Scopes
			m.ExpiresAt = r.ExpiresAt
			return nil
		case "revoke":
			if actor != target && actor != p.Creator {
				return collabFail(403, "creator or self required")
			}
			if target == p.Creator {
				return collabFail(409, "creator membership required")
			}
			m.State = "revoked"
			for _, t := range p.Tasks {
				if t.Assignee == target && t.State == "running" {
					t.State = "blocked"
					t.LeaseUntil = 0
					if e := tx.Exec(`UPDATE collaboration_runs SET status='revoked',lease_until=0 WHERE project_id=? AND task_id=? AND epoch=?`, p.ID, t.ID, t.Epoch).Error; e != nil {
						return e
					}
				}
			}
			return nil
		}
	case "tasks":
		if r.Action == "create" {
			if len(p.Tasks) >= 100 {
				return collabFail(409, "project task limit reached")
			}
			if e := require("coordinate"); e != nil {
				return e
			}
			if r.TaskID == "" || len(r.TaskID) > 128 || p.Tasks[r.TaskID] != nil || strings.TrimSpace(r.Title) == "" || len(r.Title) > 1000 || len(r.Input) > 16000 || len(r.Output) > 8000 {
				return collabFail(400, "invalid task")
			}
			if !collabHas(p, r.Reviewer, "review", now) {
				return collabFail(403, "active reviewer required")
			}
			seen := map[string]bool{}
			for _, dep := range r.Dependencies {
				if p.Tasks[dep] == nil || seen[dep] {
					return collabFail(400, "invalid dependency")
				}
				seen[dep] = true
			}
			t := &collaborationTask{ID: r.TaskID, Title: r.Title, Input: r.Input, Output: r.Output, Reviewer: r.Reviewer, Dependencies: r.Dependencies, State: "ready"}
			p.Tasks[t.ID] = t
			if r.Assignee != "" {
				if !collabHas(p, r.Assignee, "work", now) {
					return collabFail(403, "worker grant required")
				}
				t.Assignee = r.Assignee
				t.State = "assigned"
			}
			return nil
		}
		t := p.Tasks[r.TaskID]
		if t == nil {
			return collabFail(404, "task unavailable")
		}
		switch r.Action {
		case "assign":
			if e := require("coordinate"); e != nil {
				return e
			}
			if t.State != "ready" && t.State != "declined" {
				return collabFail(409, "task not assignable")
			}
			if !collabHas(p, r.Assignee, "work", now) {
				return collabFail(403, "worker grant required")
			}
			t.Assignee = r.Assignee
			t.State = "assigned"
			return nil
		case "cancel":
			if e := require("coordinate"); e != nil {
				return e
			}
			if t.State == "accepted_result" || t.State == "cancelled" {
				return collabFail(409, "task terminal")
			}
			t.State = "cancelled"
			t.LeaseUntil = 0
			return tx.Exec(`UPDATE collaboration_runs SET status='cancelled',lease_until=0 WHERE project_id=? AND task_id=? AND epoch=?`, p.ID, t.ID, t.Epoch).Error
		}
		if actor != t.Assignee {
			return collabFail(403, "assignee required")
		}
		if e := require("work"); e != nil {
			return e
		}
		switch r.Action {
		case "accept", "decline":
			if t.State != "assigned" {
				return collabFail(409, "assignment unavailable")
			}
			if r.Action == "accept" {
				t.State = "accepted"
			} else {
				t.State = "declined"
			}
			return nil
		case "start":
			if t.State != "accepted" && t.State != "changes_requested" {
				return collabFail(409, "task cannot start")
			}
			for _, dep := range t.Dependencies {
				if p.Tasks[dep].State != "accepted_result" {
					return collabFail(409, "dependency not accepted")
				}
			}
			if strings.TrimSpace(r.Host) == "" || len(r.Host) > 200 {
				return collabFail(400, "host required")
			}
			t.Epoch++
			t.LeaseUntil = now + 90000
			t.State = "running"
			return tx.Exec(`INSERT INTO collaboration_runs VALUES(?,?,?,?,?,'running',?)`, p.ID, t.ID, t.Epoch, actor, r.Host, t.LeaseUntil).Error
		case "heartbeat", "block":
			if t.State != "running" || r.Epoch != t.Epoch || t.LeaseUntil <= now {
				return collabFail(409, "stale execution lease")
			}
			if r.Action == "heartbeat" {
				t.LeaseUntil = now + 90000
			} else {
				if strings.TrimSpace(r.Text) == "" {
					return collabFail(400, "block reason required")
				}
				t.State = "blocked"
				t.LeaseUntil = 0
			}
			return tx.Exec(`UPDATE collaboration_runs SET status=?,lease_until=? WHERE project_id=? AND task_id=? AND epoch=?`, t.State, t.LeaseUntil, p.ID, t.ID, t.Epoch).Error
		case "recover":
			if t.State != "blocked" && (t.State != "running" || t.LeaseUntil > now) {
				return collabFail(409, "recovery not available")
			}
			if strings.TrimSpace(r.Text) == "" {
				return collabFail(400, "external effects and recovery assessment required")
			}
			t.State = "accepted"
			t.LeaseUntil = 0
			return tx.Exec(`UPDATE collaboration_runs SET status='recovered',lease_until=0 WHERE project_id=? AND task_id=? AND epoch=?`, p.ID, t.ID, t.Epoch).Error
		}
	case "submit":
		t := p.Tasks[r.TaskID]
		if t == nil {
			return collabFail(404, "task unavailable")
		}
		if e := require("work"); e != nil {
			return e
		}
		if t.Assignee != actor {
			return collabFail(403, "assignee required")
		}
		if t.State != "running" || t.Epoch != r.Epoch || t.LeaseUntil <= now {
			return collabFail(409, "stale execution lease")
		}
		a := r.Artifact
		if a == nil || len(a.Text) > 32768 || len(a.URI) > 2048 || len(a.Provenance) > 8000 || len(a.Verification) > 8000 {
			return collabFail(400, "invalid artifact")
		}
		if a.Kind == "text" {
			if strings.TrimSpace(a.Text) == "" || a.URI != "" {
				return collabFail(400, "inline text required")
			}
		} else if a.Kind == "https" {
			u, e := url.Parse(a.URI)
			if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || a.Text != "" {
				return collabFail(400, "HTTPS artifact reference required")
			}
		} else {
			return collabFail(400, "artifact kind must be text or https")
		}
		t.ArtifactVersion++
		a.Version = t.ArtifactVersion
		a.TaskID = t.ID
		a.Submitter = actor
		digest := sha256.Sum256([]byte(a.Text + a.URI))
		a.Digest = hex.EncodeToString(digest[:])
		t.State = "submitted"
		t.LeaseUntil = 0
		if e := tx.Exec(`INSERT INTO collaboration_artifacts VALUES(?,?,?,?::jsonb)`, p.ID, t.ID, a.Version, collabJSON(a)).Error; e != nil {
			return e
		}
		return tx.Exec(`UPDATE collaboration_runs SET status='submitted',lease_until=0 WHERE project_id=? AND task_id=? AND epoch=?`, p.ID, t.ID, t.Epoch).Error
	case "review":
		t := p.Tasks[r.TaskID]
		if t == nil {
			return collabFail(404, "task unavailable")
		}
		if e := require("review"); e != nil {
			return e
		}
		if t.Reviewer != actor {
			return collabFail(403, "fixed reviewer required")
		}
		if t.State != "submitted" || r.ArtifactVersion != t.ArtifactVersion {
			return collabFail(409, "exact pending artifact version required")
		}
		switch r.Action {
		case "accept":
			t.State = "accepted_result"
		case "changes_requested":
			t.State = "changes_requested"
		case "reject":
			t.State = "failed"
		default:
			return collabFail(400, "invalid review decision")
		}
		if len(r.Text) > 8000 || (r.Action != "accept" && strings.TrimSpace(r.Text) == "") {
			return collabFail(400, "review reason required")
		}
		return tx.Exec(`INSERT INTO collaboration_reviews VALUES(?,?,?,?,?,?,?)`, p.ID, t.ID, r.ArtifactVersion, actor, r.Action, r.Text, now).Error
	case "updates":
		if r.Action == "publish" {
			if len(r.Text) > 8000 || strings.TrimSpace(r.Text) == "" {
				return collabFail(400, "update text required")
			}
			if r.TaskID != "" && p.Tasks[r.TaskID] == nil {
				return collabFail(404, "task unavailable")
			}
			return nil
		}
	}
	return collabFail(400, "unsupported collaboration action")
}

func collabRead(endpoint, action string) bool {
	return (endpoint == "project" && (action == "list" || action == "get")) || (endpoint == "tasks" && (action == "list" || action == "get")) || endpoint == "context" || (endpoint == "updates" && action == "read")
}
func (s *Service) collaborationAuth(endpoint string) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		var r struct {
			Action string `json:"action"`
		}
		_ = json.Unmarshal(c.Request.Body(), &r)
		scope := "communication:write"
		if collabRead(endpoint, r.Action) {
			scope = "communication:read"
		}
		s.agentAuth(scope)(ctx, c)
	}
}

// Validate persisted owner bindings and delegation ancestry on every access.
// Restricting a grant immediately intersects all descendants, including old invitations.
func collabRefreshGrants(tx *gorm.DB, p *collaborationProject, now int64) error {
	seen := map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if seen[id] {
			return nil
		}
		seen[id] = true
		m := p.Members[id]
		if m == nil {
			return nil
		}
		owner, e := collabOwner(tx, id)
		if e != nil {
			var f *collaborationFailure
			if !errors.As(e, &f) {
				return e
			}
			m.State = "revoked"
			return nil
		}
		if owner != m.OwnerUID {
			m.State = "revoked"
			return nil
		}
		if id == p.Creator {
			return nil
		}
		if e := visit(m.Inviter); e != nil {
			return e
		}
		parent := collabMember(p, m.Inviter, now)
		if parent == nil {
			m.State = "revoked"
			return nil
		}
		effective := []string{}
		for _, scope := range m.Scopes {
			if collabContains(parent.Scopes, scope) {
				effective = append(effective, scope)
			}
		}
		m.Scopes = effective
		if parent.ExpiresAt > 0 && (m.ExpiresAt == 0 || m.ExpiresAt > parent.ExpiresAt) {
			m.ExpiresAt = parent.ExpiresAt
		}
		return nil
	}
	for id := range p.Members {
		if e := visit(id); e != nil {
			return e
		}
	}
	return nil
}

func (e *collaborationFailure) code() string {
	switch e.message {
	case "project exceeds 256 KiB; split the work into smaller projects":
		return "COLLABORATION_PROJECT_LIMIT"
	case "collaboration result exceeds 8 MiB; reduce the project or page content":
		return "COLLABORATION_RESULT_LIMIT"
	case "project version conflict":
		return "COLLABORATION_VERSION_CONFLICT"
	case "idempotency key payload conflict":
		return "COLLABORATION_KEY_CONFLICT"
	case "idempotency receipt erased":
		return "COLLABORATION_RECEIPT_ERASED"
	case "stale execution lease":
		return "COLLABORATION_STALE_LEASE"
	}
	switch e.status {
	case 400:
		return "COLLABORATION_INVALID_REQUEST"
	case 403:
		return "COLLABORATION_ACCESS_DENIED"
	case 404:
		return "COLLABORATION_NOT_FOUND"
	default:
		return "COLLABORATION_STATE_CONFLICT"
	}
}

func collabValidStrings(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.String:
		return !strings.ContainsRune(v.String(), 0)
	case reflect.Pointer:
		if !v.IsNil() {
			return collabValidStrings(v.Elem())
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if !collabValidStrings(v.Field(i)) {
				return false
			}
		}
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			if !collabValidStrings(v.Index(i)) {
				return false
			}
		}
	}
	return true
}
