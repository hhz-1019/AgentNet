package consolev2

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

// Only browser session identity is a fixture. Reads/writes use real Go handlers
// and an isolated PostgreSQL engine; this does not prove a production login.
func runNetworkBrowser(t *testing.T, s *Service) {
	t.Helper()
	if e := s.db.Exec(`UPDATE friend_requests SET status=0 WHERE id=720;
 DELETE FROM user_relations WHERE (from_uid=701 AND to_uid=705) OR (from_uid=705 AND to_uid=701);
 DELETE FROM console_network_reads WHERE agent_id=701;`).Error; e != nil {
		t.Fatal(e)
	}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		c.Set("agent_id", int64(701))
		c.Set("console_session_id", "network-session")
		c.Next(ctx)
	}
	h.GET("/api/v2/console/network", auth, s.getNetwork)
	h.GET("/api/v2/console/network/nodes/:peer_id/events", auth, s.getNetworkEvents)
	h.POST("/api/v2/console/network/read", auth, s.readNetworkEvent)
	h.POST("/api/v2/console/network/requests/:request_id", auth, s.decideNetworkRequest)
	h.GET("/api/v2/console/portrait", auth, s.getPortrait)
	h.PUT("/api/v2/console/portrait", auth, s.putPortrait)
	h.GET("/api/v2/console/twin/policy", auth, s.getTwinPolicy)
	h.PUT("/api/v2/console/twin/policy", auth, s.putTwinPolicy)
	h.GET("/api/v2/console/session", auth, func(_ context.Context, c *app.RequestContext) {
		reply(c, 200, map[string]any{"agent_id": "701", "agent_name": "我的 Agent", "owner_uid": "network-owner", "owner_bound": true, "onboarding": map[string]any{"state": "completed"}})
	})
	h.GET("/api/v2/console/avatars", auth, func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"items": []any{}}) })
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, e := io.ReadAll(r.Body)
		if e != nil {
			http.Error(w, "body", 400)
			return
		}
		headers := []ut.Header{}
		for k, values := range r.Header {
			for _, value := range values {
				headers = append(headers, ut.Header{Key: k, Value: value})
			}
		}
		response := ut.PerformRequest(h.Engine, r.Method, r.URL.RequestURI(), &ut.Body{Body: strings.NewReader(string(body)), Len: len(body)}, headers...)
		response.Header().VisitAll(func(k, v []byte) { w.Header().Add(string(k), string(v)) })
		w.WriteHeader(response.Code)
		_, _ = w.Write(response.Body.Bytes())
	}))
	defer gateway.Close()
	command := exec.Command("node", os.Getenv("AGENTNET_SOCIAL_BROWSER_SCRIPT"))
	command.Env = append(os.Environ(), "AGENTNET_SOCIAL_BROWSER_CORE="+gateway.URL)
	output, e := command.CombinedOutput()
	t.Log(string(output))
	if e != nil {
		t.Fatal(e)
	}
}
