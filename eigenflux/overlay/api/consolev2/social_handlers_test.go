package consolev2

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func socialTestDocument() socialDocument {
	return socialDocument{Title: "一次具体工作的复盘", Summary: "这是一份可以接着做的工作成果说明。", Body: "我们记录了任务的背景、具体做法、结果与复现步骤，同时明确哪些结论仍然需要继续验证。", Kind: "result", Tags: []string{"React", "Agent 工程"}, Source: "实际开发任务记录", Evidence: "复现步骤与验证边界", Identity: "human", Media: []socialMedia{}}
}
func TestSocialQualityPreflight(t *testing.T) {
	d := socialTestDocument()
	if err := validateSocialDocument(&d, "public"); err != nil {
		t.Fatal(err)
	}
	for _, visibility := range []string{"related_agents", "invalid"} {
		if validateSocialDocument(&d, visibility) == nil {
			t.Fatal("unsupported scope accepted")
		}
	}
	for _, u := range []string{"javascript:alert(1)", "http://example.com", "https://user:pass@example.com", "/social/../private"} {
		if validSocialURL(u, true) {
			t.Fatal("unsafe attachment accepted", u)
		}
	}
	d.Body += " api_key=abcdefghijk12345"
	blocked, _ := socialPreflight(d)
	if len(blocked) == 0 {
		t.Fatal("credential preflight failed")
	}
	d = socialTestDocument()
	d.Identity = "project"
	if validateSocialDocument(&d, "public") == nil {
		t.Fatal("missing attribution accepted")
	}
	d = socialTestDocument()
	d.Tags = []string{"React", "react"}
	if validateSocialDocument(&d, "public") == nil {
		t.Fatal("case-insensitive duplicate accepted")
	}
}
func TestSocialPostgresApprovalAccessAndInteractions(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:social:core for isolated PostgreSQL protocol coverage")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 9223372036854774000}}
	h := server.New()
	inject := func(_ context.Context, c *app.RequestContext) {
		var id int64 = 1
		if string(c.GetHeader("Test-Viewer")) == "2" {
			id = 2
		}
		c.Set("agent_id", id)
		c.Next(context.Background())
	}
	h.POST("/drafts", inject, s.createSocialDraft)
	h.PUT("/drafts/:post_id", inject, s.updateSocialDraft)
	h.POST("/posts/:post_id/publish", inject, s.publishSocialPost)
	h.GET("/posts", inject, s.listSocialPosts)
	h.GET("/posts/:post_id", inject, s.getSocialPost)
	h.PUT("/posts/:post_id/reaction", inject, s.setSocialReaction)
	h.GET("/posts/:post_id/comments", inject, s.listSocialComments)
	h.POST("/posts/:post_id/comments", inject, s.createSocialComment)
	h.GET("/commands", inject, s.listSocialCommands)
	call := func(method, path string, body any, viewer string, want int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		resp := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(data)), Len: len(data)}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Test-Viewer", Value: viewer})
		if resp.Code != want {
			t.Fatalf("%s %s got %d want %d: %s", method, path, resp.Code, want, resp.Body.String())
		}
		var result map[string]any
		if json.Unmarshal(resp.Body.Bytes(), &result) != nil {
			t.Fatal("invalid response")
		}
		out, _ := result["data"].(map[string]any)
		return out
	}
	d := socialTestDocument()
	post := call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "private"}, "1", 201)
	id := post["id"].(string)
	if id != "9223372036854774001" {
		t.Fatal("ID lost precision", id)
	}
	call("GET", "/posts/"+id, nil, "2", 404)
	call("POST", "/posts/"+id+"/publish", map[string]any{"expected_revision": 1, "approved": false, "privacy_reviewed": true}, "1", 400)
	call("PUT", "/drafts/"+id, socialWriteRequest{Document: d, Visibility: "friends", ExpectedRevision: 1}, "1", 200)
	call("POST", "/posts/"+id+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "1", 409)
	approval := map[string]any{"expected_revision": 2, "approved": true, "privacy_reviewed": true}
	call("POST", "/posts/"+id+"/publish", approval, "1", 200)
	call("POST", "/posts/"+id+"/publish", approval, "1", 200)
	call("GET", "/posts/"+id, nil, "2", 404)
	if err := db.Exec("INSERT INTO user_relations VALUES (2,1,1)").Error; err != nil {
		t.Fatal(err)
	}
	call("GET", "/posts/"+id, nil, "2", 200)
	if err := db.Exec("INSERT INTO user_relations VALUES (1,2,2)").Error; err != nil {
		t.Fatal(err)
	}
	call("GET", "/posts/"+id, nil, "2", 404)
	call("PUT", "/posts/"+id+"/reaction", map[string]any{"kind": "like", "active": true}, "2", 404)
	db.Exec("DELETE FROM user_relations WHERE rel_type=2")
	reaction := map[string]any{"kind": "like", "active": true}
	call("PUT", "/posts/"+id+"/reaction", reaction, "2", 200)
	liked := call("PUT", "/posts/"+id+"/reaction", reaction, "2", 200)
	if liked["likes"].(float64) != 1 {
		t.Fatal("reaction is not idempotent")
	}
	call("PUT", "/posts/"+id+"/reaction", map[string]any{"kind": "save", "active": true}, "2", 200)
	items := call("GET", "/posts?scope=saved&tags=%5B%22React%22%2C%22Agent%20%E5%B7%A5%E7%A8%8B%22%5D", nil, "2", 200)["items"].([]any)
	if len(items) != 1 {
		t.Fatal("tag intersection lost matching post")
	}
	items = call("GET", "/posts?tags=%5B%22React%22%2C%22Missing%22%5D", nil, "2", 200)["items"].([]any)
	if len(items) != 0 {
		t.Fatal("tag filtering used union")
	}
	comment := map[string]any{"content": "这里可以补充一次具体的对照验证。", "idempotency_key": "same-comment"}
	call("POST", "/posts/"+id+"/comments", comment, "2", 200)
	call("POST", "/posts/"+id+"/comments", comment, "2", 200)
	comments := call("GET", "/posts/"+id+"/comments", nil, "2", 200)["items"].([]any)
	if len(comments) != 1 {
		t.Fatal("duplicate comment created")
	}
	comment["content"] = "different"
	call("POST", "/posts/"+id+"/comments", comment, "2", 409)
	// A project proposal requires separate acknowledgement; credentials never publish.
	d.Identity = "project"
	d.ProjectName = "Example project"
	p := call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, "1", 201)
	pid := p["id"].(string)
	call("POST", "/posts/"+pid+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "1", 400)
	d = socialTestDocument()
	d.Body += " token=abcdefghijklmnop"
	p = call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, "1", 201)
	call("POST", "/posts/"+p["id"].(string)+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "1", 400)
	// The Agent proposal endpoint cannot choose public visibility.
	h.POST("/api/v2/social/drafts", inject, s.createSocialDraft)
	proposed := call("POST", "/api/v2/social/drafts", socialWriteRequest{Document: socialTestDocument(), Visibility: "public"}, "1", 201)
	if proposed["visibility"] != "private" || proposed["state"] != "draft" {
		t.Fatal("Agent proposal bypassed human review")
	}
	// A private published item stays private; a foreign owner cannot publish it.
	private := call("POST", "/drafts", socialWriteRequest{Document: socialTestDocument(), Visibility: "private"}, "1", 201)
	privateID := private["id"].(string)
	call("POST", "/posts/"+privateID+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "2", 404)
	call("POST", "/posts/"+privateID+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "1", 200)
	call("GET", "/posts/"+privateID, nil, "2", 404)
	call("GET", "/posts/"+privateID, nil, "1", 200)

	commands := call("GET", "/commands", nil, "1", http.StatusOK)["items"].([]any)
	if len(commands) != 1 {
		t.Fatal("missing owner command")
	}
	if commands[0].(map[string]any)["result"].(map[string]any)["reply"] != "真实执行回执" {
		t.Fatal("command receipt lost")
	}
}
