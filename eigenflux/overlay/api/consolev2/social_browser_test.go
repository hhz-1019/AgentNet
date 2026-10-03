package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

// Authentication/session metadata are fixtures. Social handlers and PostgreSQL are real.
func TestSocialBrowserLive(t *testing.T) {
	script := os.Getenv("AGENTNET_SOCIAL_BROWSER_SCRIPT")
	if script == "" {
		t.Skip("run npm run test:social:live with Chromium installed")
	}
	db := socialFixtureDB(t, os.Getenv("AGENTNET_SOCIAL_TEST_DSN"))
	defer func() {
		db.Exec("DELETE FROM social_work_posts")
		db.Exec("DELETE FROM social_media")
		db.Exec("DELETE FROM social_preferences")
		db.Exec("DELETE FROM social_organizations")
	}()
	if err := db.Exec("DELETE FROM social_work_posts").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DELETE FROM social_preferences").Error; err != nil {
		t.Fatal(err)
	}
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 9223372036854773000}}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		var id int64 = 1
		if string(c.Cookie("social_viewer")) == "2" {
			id = 2
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	root := "/api/v2/console/social"
	h.GET(root+"/organizations", auth, s.getSocialOrganizations)
	h.POST(root+"/organizations", auth, s.createSocialOrganization)
	h.PUT(root+"/organizations/:organization_id/members/:member_id", auth, s.setSocialOrganizationMember)
	h.POST(root+"/organizations/:organization_id/join", auth, s.joinSocialOrganization)
	h.GET(root+"/preferences", auth, s.getSocialPreferences)
	h.PUT(root+"/preferences", auth, s.putSocialPreferences)
	h.GET(root+"/recommendations", auth, s.getSocialRecommendations)
	h.POST(root+"/media", auth, s.uploadSocialMedia)
	h.GET(root+"/media/:media_id", auth, s.getSocialMedia)
	h.GET(root+"/posts", auth, s.listSocialPosts)
	h.GET(root+"/posts/:post_id", auth, s.getSocialPost)
	h.POST(root+"/drafts", auth, s.createSocialDraft)
	h.PUT(root+"/drafts/:post_id", auth, s.updateSocialDraft)
	h.POST(root+"/posts/:post_id/publish", auth, s.publishSocialPost)
	h.GET(root+"/commands", auth, s.listSocialCommands)
	h.GET("/api/v2/console/session", auth, func(_ context.Context, c *app.RequestContext) {
		id, _ := agentID(c)
		reply(c, 200, map[string]any{"agent_id": strconv.FormatInt(id, 10), "agent_name": "Browser Agent", "short_id": "TEST", "owner_uid": "fixture", "owner_bound": true, "onboarding": map[string]any{"state": "completed", "current_step": 4, "revision": 1}})
	})
	h.GET("/api/v2/console/today/status", func(_ context.Context, c *app.RequestContext) {
		reply(c, 200, map[string]any{"runtime_state": "not_started", "fresh_until": 0})
	})
	h.GET("/api/v2/console/home/discovery", func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"items": []any{}}) })
	h.GET("/api/v2/console/accounts", func(_ context.Context, c *app.RequestContext) { reply(c, 200, map[string]any{"accounts": []any{}}) })
	h.GET("/api/v2/public/agents/by-id/:id/card", func(_ context.Context, c *app.RequestContext) {
		reply(c, 200, map[string]any{"card": map[string]any{"offering": []string{}, "seeking": []string{}}})
	})
	h.GET("/api/v2/console/activity/stream", func(_ context.Context, c *app.RequestContext) {
		c.Data(200, "text/event-stream", []byte(": fixture\n\n"))
	})
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
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
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", script)
	command.Env = append(os.Environ(), "AGENTNET_SOCIAL_BROWSER_CORE="+gateway.URL, "AGENTNET_SOCIAL_TEST_IMAGE="+base64.StdEncoding.EncodeToString(imageData.Bytes()))
	output, err := command.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatal(err)
	}
}
