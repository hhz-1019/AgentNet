package cmd

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCollaborationRouteStrict(t *testing.T) {
	cases := []struct{ group, body string }{
		{"project", `{"action":"create","goal":"goal","expected_version":0,"idempotency_key":"a"}`},
		{"membership", `{"action":"accept","project_id":"p","expected_version":1,"idempotency_key":"b"}`},
		{"tasks", `{"action":"heartbeat","project_id":"p","task_id":"t","epoch":2,"expected_version":1,"idempotency_key":"c"}`},
		{"context", `{"project_id":"p","cursor":0}`},
		{"updates", `{"action":"read","project_id":"p","cursor":2}`},
		{"submit", `{"project_id":"p","task_id":"t","epoch":2,"expected_version":1,"idempotency_key":"d","artifact":{"kind":"text","text":"real result","provenance":"source","verification":"fixture"}}`},
		{"review", `{"action":"accept","project_id":"p","task_id":"t","artifact_version":1,"expected_version":1,"idempotency_key":"e"}`},
	}
	for _, c := range cases {
		t.Run(c.group, func(t *testing.T) {
			route, req, e := collaborationRoute(c.group, []byte(c.body))
			if e != nil || route != "/collaboration/"+c.group {
				t.Fatalf("route: %s %v", route, e)
			}
			encoded, _ := json.Marshal(req)
			var original map[string]any
			json.Unmarshal([]byte(c.body), &original)
			var actual map[string]any
			json.Unmarshal(encoded, &actual)
			if len(original) != len(actual) {
				t.Fatal("discarded fields")
			}
			for _, suffix := range []string{`,"owner_approved":true}`, `,"unexpected":1}`} {
				_, _, e = collaborationRoute(c.group, []byte(strings.TrimSuffix(c.body, "}")+suffix))
				if e == nil {
					t.Fatal("accepted unknown field")
				}
			}
		})
	}
	invalid := []struct{ group, body string }{
		{"../project", `{}`}, {"project", `{"action":"unknown"}`}, {"tasks", `{"action":"list","project_id":"p","epoch":1}`},
		{"project", `{"action":"get","project_id":"p"} {}`}, {"project", `{"action":"get","project_id":"p","owner_approved":true}`},
		{"project", `{"action":"create","goal":"x","expected_version":0.5,"idempotency_key":"x"}`},
		{"updates", `{"action":"read","project_id":"p","cursor":-1}`},
		{"review", `{"action":"reject","project_id":"p","task_id":"t","artifact_version":1,"expected_version":1,"idempotency_key":"e"}`},
		{"submit", `{"project_id":"p","task_id":"t","epoch":2,"expected_version":1,"idempotency_key":"d","artifact":{"kind":"https","uri":"https://u:p@example.test","provenance":"","verification":""}}`},
		{"project", `null`},
	}
	for _, c := range invalid {
		if _, _, e := collaborationRoute(c.group, []byte(c.body)); e == nil {
			t.Fatalf("accepted invalid %s", c.body)
		}
	}
}

func TestCollaborationRequestLimit(t *testing.T) {
	if _, _, e := collaborationRoute("project", []byte(`{"action":"create","goal":"bad\u0000goal","expected_version":0,"idempotency_key":"nul"}`)); e == nil {
		t.Fatal("NUL accepted by CLI")
	}
	for _, char := range []string{"<", "&", "\x01"} {
		req := map[string]any{"project_id": "p", "task_id": "t", "epoch": 1, "expected_version": 1, "idempotency_key": "escaped", "artifact": map[string]any{"kind": "text", "text": strings.Repeat(char, 32768), "provenance": strings.Repeat(char, 8000), "verification": strings.Repeat(char, 8000)}}
		raw, e := json.Marshal(req)
		if e != nil {
			t.Fatal(e)
		}
		if _, _, e = collaborationRoute("submit", raw); e != nil {
			t.Fatal("maximum legal escaped artifact rejected", e)
		}
	}
	raw := []byte(`{"project_id":"p"}`)
	raw = append(raw, []byte(strings.Repeat(" ", (512<<10)-len(raw)))...)
	if _, _, e := collaborationRoute("context", raw); e != nil {
		t.Fatal("exact wire boundary rejected", e)
	}
	if _, _, e := collaborationRoute("context", append(raw, ' ')); e == nil {
		t.Fatal("first over-limit byte accepted")
	}
}
