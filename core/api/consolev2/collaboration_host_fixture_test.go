package consolev2

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

type installationFixtureIDs struct{ value atomic.Int64 }

func (g *installationFixtureIDs) NextID() (int64, error) { return g.value.Add(1), nil }

// Opt-in loopback fixture for REAL installed host sessions. Only authentication
// uses fixture bearer tokens; collaboration handlers and SQL transactions are
// the production implementation. This helper is absent from production builds.
func TestCollaborationHostFixture(t *testing.T) {
	directory := os.Getenv("AGENTNET_COLLABORATION_HOST_FIXTURE")
	if directory == "" {
		t.Skip("explicit local host acceptance only")
	}
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if !filepath.IsAbs(directory) || !strings.Contains(dsn, "host=127.0.0.1 ") {
		t.Fatal("absolute fixture directory and loopback database required")
	}
	db := collaborationFixtureDB(t, dsn)
	s := &Service{db: db}
	installationMode := os.Getenv("AGENTNET_PLUGIN_TEST_LOOPBACK") == "1"
	if installationMode {
		s.idgen = &installationFixtureIDs{}
	}
	tokens := map[string]string{"1": collabID() + collabID(), "2": collabID() + collabID()}
	h := server.New()
	fixtureAuth := func(ctx context.Context, c *app.RequestContext) {
		token := strings.TrimPrefix(string(c.GetHeader("Authorization")), "Bearer ")
		for actor, expected := range tokens {
			if subtle.ConstantTimeCompare([]byte(token), []byte(expected)) == 1 {
				id, _ := strconv.ParseInt(actor, 10, 64)
				c.Set("agent_id", id)
				c.Next(ctx)
				return
			}
		}
		fail(c, 401, "FIXTURE_AUTH_REQUIRED", "local fixture authentication required", nil)
		c.Abort()
	}
	for _, group := range []string{"project", "membership", "tasks", "context", "updates", "submit", "review"} {
		if !installationMode {
			h.POST("/api/v2/collaboration/"+group, fixtureAuth, s.collaborationHandler(group))
		}
	}
	if installationMode {
		s.Register(h)
	}
	listener := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, (512<<10)+1))
		if err != nil {
			http.Error(w, "read failed", 400)
			return
		}
		headers := []ut.Header{}
		for key, values := range r.Header {
			for _, value := range values {
				headers = append(headers, ut.Header{Key: key, Value: value})
			}
		}
		response := ut.PerformRequest(h.Engine, r.Method, r.URL.RequestURI(), &ut.Body{Body: bytes.NewReader(body), Len: len(body)}, headers...)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.Code)
		_, _ = w.Write(response.Body.Bytes())
	}))
	defer listener.Close()
	s.publicURL = listener.URL
	write := func(name string, value any) {
		t.Helper()
		raw, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(directory, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if installationMode {
		write("ready.json", map[string]any{"endpoint": listener.URL, "authentication": "production installation enrollment and Ed25519 verification"})
	} else {
		write("ready.json", map[string]any{"endpoint": listener.URL, "fixture_tokens": tokens, "authentication": "loopback-only fixture bearer; not production identity provisioning"})
	}
	deadline := time.Now().Add(18 * time.Minute)
	for {
		if _, err := os.Stat(filepath.Join(directory, "stop")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("host fixture acceptance timed out")
		}
		time.Sleep(200 * time.Millisecond)
	}
	dump := map[string]any{}
	for _, table := range []string{"collaboration_projects", "collaboration_artifacts", "collaboration_reviews", "collaboration_runs", "collaboration_events"} {
		var rows []string
		if err := db.Raw("SELECT row_to_json(records)::text FROM " + table + " records").Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		values := make([]json.RawMessage, 0, len(rows))
		for _, row := range rows {
			values = append(values, json.RawMessage(row))
		}
		dump[table] = values
	}
	write("database.json", dump)
}
