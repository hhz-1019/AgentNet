package client

import (
	"bytes"
	"elsewhere.local/cli/internal/output"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCollaborationLargeResponseTransport(t *testing.T) {
	projects := make([]any, 20)
	for i := range projects {
		tasks := map[string]any{}
		for _, id := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"} {
			tasks[id] = map[string]any{"task_id": id, "title": "task", "input": strings.Repeat("<", 1500) + strings.Repeat("a", 10500), "output": "", "assignee": "1", "reviewer": "1", "dependencies": []string{}, "state": "ready", "epoch": 0, "lease_until": 0, "artifact_version": 0}
		}
		project := map[string]any{"project_id": "fixture", "goal": "goal", "requirements": "", "state": "active", "version": 1, "sequence": 1, "creator": "1", "members": map[string]any{}, "tasks": tasks}
		encoded, _ := json.Marshal(project)
		if len(encoded) > 256<<10 {
			t.Fatal("fixture exceeds project cap")
		}
		projects[i] = project
	}
	result := map[string]any{"projects": projects, "next_cursor": 20, "has_more": true}
	body, _ := json.Marshal(map[string]any{"data": result})
	if len(body) <= 2<<20 || len(body) > 8<<20 {
		t.Fatal("fixture does not test legal large response")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/collaboration/project" || r.Method != "POST" || r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("wrong authenticated route")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}))
	defer server.Close()
	client := New(server.URL, "fixture-token", "fixture", Meta{})
	response, e := client.Post("/api/v2/collaboration/project", map[string]any{"action": "list"})
	if e != nil {
		t.Fatal(e)
	}
	var stdout bytes.Buffer
	output.PrintDataTo(&stdout, response.Data, "json")
	if stdout.Len() <= 2<<20 || stdout.Len() > maxResponseBytes {
		t.Fatal("CLI output does not fit collaboration stdout cap")
	}
	var decoded struct{ Projects []json.RawMessage }
	if e = json.Unmarshal(stdout.Bytes(), &decoded); e != nil || len(decoded.Projects) != 20 {
		t.Fatal("CLI truncated legal project list", e)
	}
	if maxResponseBytes != 16<<20 {
		t.Fatal("HTTP cap changed")
	}
}
