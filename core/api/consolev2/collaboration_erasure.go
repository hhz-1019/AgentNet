package consolev2

import (
	"encoding/json"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// Called inside account erasure, after departing Agent rows are locked. Normal
// collaboration mutations lock actor then project in the same order. No owner
// transfer exists: creator projects disappear, other owners' projects survive.
func eraseCollaboration(tx *gorm.DB, agents []int64) error {
	if len(agents) == 0 {
		return nil
	}
	// Older fixture schemas and databases before migration157 have no collaboration.
	var exists bool
	if e := tx.Raw(`SELECT to_regclass('collaboration_projects') IS NOT NULL`).Scan(&exists).Error; e != nil {
		return e
	}
	if !exists {
		return nil
	}
	if e := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id IN ? ORDER BY agent_id FOR UPDATE`, agents).Error; e != nil {
		return e
	}
	removed := map[string]bool{}
	for _, id := range agents {
		removed[strconv.FormatInt(id, 10)] = true
	}
	// Lock all projects in stable order, then inspect membership/history. This
	// also catches invited-only JSON identities with no relational participant FK.
	var rows []struct {
		ProjectID, Document string
		Version, Sequence   int64
	}
	if e := tx.Raw(`SELECT project_id,document::text,version,sequence FROM collaboration_projects ORDER BY project_id FOR UPDATE`).Scan(&rows).Error; e != nil {
		return e
	}
	for _, row := range rows {
		var p collaborationProject
		if e := json.Unmarshal([]byte(row.Document), &p); e != nil {
			return e
		}
		if removed[p.Creator] {
			for _, table := range []string{"collaboration_reviews", "collaboration_artifacts", "collaboration_runs", "collaboration_events", "collaboration_idempotency", "collaboration_projects"} {
				if e := tx.Exec("DELETE FROM "+table+" WHERE project_id=?", row.ProjectID).Error; e != nil {
					return e
				}
			}
			continue
		}
		affected := false
		blocked := map[string]bool{}
		for id := range removed {
			blocked[id] = true
			if p.Members[id] != nil {
				affected = true
				blocked[id] = true
			}
		}
		// Revocation follows the full delegation tree, including pending invitations.
		for changed := true; changed; {
			changed = false
			for id, m := range p.Members {
				if !blocked[id] && blocked[m.Inviter] {
					blocked[id] = true
					changed = true
					affected = true
				}
			}
		}
		authored := map[string]bool{}
		var events []struct {
			Sequence int64
			Actor    *int64
			Document string
		}
		if e := tx.Raw(`SELECT sequence,actor,document::text FROM collaboration_events WHERE project_id=? ORDER BY sequence`, p.ID).Scan(&events).Error; e != nil {
			return e
		}
		for _, ev := range events {
			if ev.Actor == nil || !removed[strconv.FormatInt(*ev.Actor, 10)] {
				continue
			}
			affected = true
			var doc struct {
				Endpoint, Action string
				TaskID           string `json:"task_id"`
			}
			if e := json.Unmarshal([]byte(ev.Document), &doc); e != nil {
				return e
			}
			if doc.Endpoint == "tasks" && doc.Action == "create" {
				authored[doc.TaskID] = true
			}
			tomb := map[string]any{"event_id": p.ID + ":" + strconv.FormatInt(ev.Sequence, 10), "endpoint": "erasure", "action": "redacted", "task_id": "", "version": row.Version + 1, "text": ""}
			if e := tx.Exec(`UPDATE collaboration_events SET actor=NULL,document=?::jsonb WHERE project_id=? AND sequence=?`, collabJSON(tomb), p.ID, ev.Sequence).Error; e != nil {
				return e
			}
		}
		var artifacts []struct {
			TaskID   string
			Version  int64
			Document string
		}
		if e := tx.Raw(`SELECT task_id,version,document::text FROM collaboration_artifacts WHERE project_id=?`, p.ID).Scan(&artifacts).Error; e != nil {
			return e
		}
		redactedTasks := map[string]bool{}
		for _, a := range artifacts {
			var doc collaborationArtifact
			if e := json.Unmarshal([]byte(a.Document), &doc); e != nil {
				return e
			}
			if removed[doc.Submitter] {
				affected = true
				redactedTasks[a.TaskID] = true
				tomb := map[string]any{"task_id": a.TaskID, "version": a.Version, "kind": "redacted", "submitter": "", "digest": "", "provenance": "", "verification": ""}
				if e := tx.Exec(`UPDATE collaboration_artifacts SET document=?::jsonb WHERE project_id=? AND task_id=? AND version=?`, collabJSON(tomb), p.ID, a.TaskID, a.Version).Error; e != nil {
					return e
				}
			}
		}
		cancelled := map[string]bool{}
		for id, t := range p.Tasks {
			cancel := authored[id] || redactedTasks[id] || blocked[t.Assignee] || removed[t.Reviewer]
			if authored[id] {
				t.Title = "[removed]"
				t.Input = ""
				t.Output = ""
				affected = true
			}
			if removed[t.Assignee] {
				t.Assignee = ""
				affected = true
			}
			if removed[t.Reviewer] {
				t.Reviewer = ""
				affected = true
			}
			if cancel {
				cancelled[id] = true
				t.State = "cancelled"
				t.LeaseUntil = 0
				affected = true
				if e := tx.Exec(`UPDATE collaboration_runs SET status='cancelled',lease_until=0 WHERE project_id=? AND task_id=?`, p.ID, id).Error; e != nil {
					return e
				}
			}
		}
		// Cancel downstream work too: a deleted/cancelled predecessor must not
		// remain an implicit accepted dependency for already-running successors.
		for changed := true; changed; {
			changed = false
			for _, task := range p.Tasks {
				if task.State == "cancelled" {
					continue
				}
				for _, dep := range task.Dependencies {
					if cancelled[dep] {
						cancelled[task.ID] = true
						task.State = "cancelled"
						task.LeaseUntil = 0
						affected = true
						changed = true
						if e := tx.Exec(`UPDATE collaboration_runs SET status='cancelled',lease_until=0 WHERE project_id=? AND task_id=?`, p.ID, task.ID).Error; e != nil {
							return e
						}
						break
					}
				}
			}
		}
		if len(cancelled) > 0 && p.State == "completed" {
			p.State = "active"
		}
		// Nullable audit actors preserve artifact/version links and contiguous events.
		for _, query := range []string{
			`UPDATE collaboration_runs SET actor=NULL,host='',status='erased',lease_until=0 WHERE project_id=? AND actor IN ?`,
			`UPDATE collaboration_reviews SET reviewer=NULL,reason='',decision='reject' WHERE project_id=? AND reviewer IN ?`,
		} {
			res := tx.Exec(query, p.ID, agents)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected > 0 {
				affected = true
			}
		}
		for id := range blocked {
			if removed[id] {
				delete(p.Members, id)
			} else {
				m := p.Members[id]
				m.State = "revoked"
				m.Scopes = []string{}
				if removed[m.Inviter] {
					m.Inviter = ""
				}
			}
		}
		// History can outlive a membership; also invalidate every survivor's cached
		// snapshot of an affected project, not merely the departing actor's cache.
		var cached int64
		if e := tx.Raw(`SELECT count(*) FROM collaboration_idempotency WHERE project_id=? AND actor IN ?`, p.ID, agents).Scan(&cached).Error; e != nil {
			return e
		}
		if cached > 0 {
			affected = true
		}
		if !affected {
			continue
		}
		if e := tx.Exec(`DELETE FROM collaboration_idempotency WHERE project_id=? AND actor IN ?`, p.ID, agents).Error; e != nil {
			return e
		}
		// Keep surviving keys/hashes/project linkage, so an uncertain old create
		// retry cannot allocate a duplicate project after its snapshot is erased.
		if e := tx.Exec(`UPDATE collaboration_idempotency SET response='{"erased_receipt":true}'::jsonb WHERE project_id=?`, p.ID).Error; e != nil {
			return e
		}
		p.Version = row.Version + 1
		p.Sequence = row.Sequence + 1
		if e := tx.Exec(`UPDATE collaboration_projects SET document=?::jsonb,version=?,sequence=? WHERE project_id=?`, collabJSON(p), p.Version, p.Sequence, p.ID).Error; e != nil {
			return e
		}
		event := map[string]any{"event_id": p.ID + ":" + strconv.FormatInt(p.Sequence, 10), "endpoint": "erasure", "action": "redacted", "task_id": "", "version": p.Version, "text": ""}
		if e := tx.Exec(`INSERT INTO collaboration_events(project_id,sequence,actor,document,created_at) VALUES(?,?,NULL,?::jsonb,?)`, p.ID, p.Sequence, collabJSON(event), time.Now().UnixMilli()).Error; e != nil {
			return e
		}
	}
	return nil
}
