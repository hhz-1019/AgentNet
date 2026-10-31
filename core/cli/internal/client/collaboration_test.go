package client

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Uses the actual collaboration Hertz failure body emitted by the core SQL
// harness, then exercises the unchanged CLI HTTP transport and APIError decoder.
func TestCollaborationErrorTransport(t *testing.T) {
	path := os.Getenv("AGENTNET_COLLABORATION_ERROR_FIXTURE")
	if path == "" {
		t.Skip("run collaboration-core-test.mjs")
	}
	body, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		_, _ = w.Write(body)
	}))
	defer server.Close()
	client := New(server.URL, "fixture-token", "fixture", Meta{})
	_, e = client.do("POST", "/api/v2/collaboration/project", map[string]any{"action": "create", "owner_approved": true})
	var api *APIError
	if !errors.As(e, &api) || api.ErrorCode != "COLLABORATION_INVALID_REQUEST" || api.Msg != "invalid collaboration request" || api.StatusCode != 400 {
		t.Fatalf("CLI cannot consume actual core envelope: %v", e)
	}
}

func TestCollaborationRequestWire(t *testing.T) {
	dir := os.Getenv("AGENTNET_COLLABORATION_WIRE_FIXTURE")
	if dir == "" {
		t.Skip("core harness")
	}
	for _, sample := range []struct{ name, char string }{{"html", "<"}, {"amp", "&"}, {"control", "\x01"}} {
		req := map[string]any{"project_id": "WIRE_PROJECT", "task_id": "WIRE_TASK", "epoch": 1, "expected_version": 1, "idempotency_key": "wire-" + sample.name, "artifact": map[string]any{"kind": "text", "text": strings.Repeat(sample.char, 32768), "provenance": strings.Repeat(sample.char, 8000), "verification": strings.Repeat(sample.char, 8000)}}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, e := io.ReadAll(r.Body)
			if e != nil {
				t.Error(e)
			}
			if e = os.WriteFile(filepath.Join(dir, sample.name+".json"), body, 0600); e != nil {
				t.Error(e)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"accepted":true}}`))
		}))
		cli := New(server.URL, "fixture", "fixture", Meta{})
		if _, e := cli.do("POST", "/api/v2/collaboration/submit", req); e != nil {
			t.Fatal(e)
		}
		server.Close()
	}
}
