package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// PGlite has one backend. Reuse its protocol connection across the suite.
var socialDBOnce sync.Once
var socialDB *gorm.DB
var socialDBError error

func socialFixtureDB(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	socialDBOnce.Do(func() {
		socialDB, socialDBError = gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
		if socialDBError == nil {
			pool, _ := socialDB.DB()
			pool.SetMaxOpenConns(1)
		}
	})
	if socialDBError != nil {
		t.Fatal(socialDBError)
	}
	return socialDB
}
func TestMain(m *testing.M) {
	code := m.Run()
	if socialDB != nil {
		pool, _ := socialDB.DB()
		_ = pool.Close()
	}
	os.Exit(code)
}
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
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 9223372036854774000}}
	h := server.New()
	inject := func(_ context.Context, c *app.RequestContext) {
		var id int64 = 1
		if string(c.GetHeader("Test-Viewer")) == "2" {
			id = 2
		} else if string(c.GetHeader("Test-Viewer")) == "3" {
			id = 3
		}
		c.Set("agent_id", id)
		c.Next(context.Background())
	}
	h.GET("/preferences", inject, s.getSocialPreferences)
	h.PUT("/preferences", inject, s.putSocialPreferences)
	h.GET("/recommendations", inject, s.getSocialRecommendations)
	h.POST("/media", inject, s.uploadSocialMedia)
	h.GET("/media", inject, s.listUnusedSocialMedia)
	h.GET("/media/:media_id", inject, s.getSocialMedia)
	h.DELETE("/media/:media_id", inject, s.deleteSocialMedia)
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
	publicDocument := d
	publicDocument.Tags = []string{"ThirdParty"}
	public := call("POST", "/drafts", socialWriteRequest{Document: publicDocument, Visibility: "public"}, "1", 201)
	publicID := public["id"].(string)
	call("POST", "/posts/"+publicID+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "1", 200)
	call("POST", "/posts/"+publicID+"/comments", map[string]any{"content": "可以检查的评论内容", "idempotency_key": "third-party-comment"}, "2", 200)
	if len(call("GET", "/posts/"+publicID+"/comments", nil, "3", 200)["items"].([]any)) != 1 {
		t.Fatal("unblocked third-party comment missing")
	}
	if err := db.Exec("INSERT INTO user_relations VALUES (3,2,2)").Error; err != nil {
		t.Fatal(err)
	}
	if len(call("GET", "/posts/"+publicID+"/comments", nil, "3", 200)["items"].([]any)) != 0 {
		t.Fatal("blocked third-party comment leaked")
	}
	if call("GET", "/posts/"+publicID, nil, "3", 200)["post"].(map[string]any)["comments"].(float64) != 0 {
		t.Fatal("blocked third-party comment count leaked")
	}
	db.Exec("DELETE FROM user_relations WHERE from_uid=3 AND to_uid=2")
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
	// Preferences are scoped to the Agent, persistent, and versioned across devices.
	prefs := call("GET", "/preferences", nil, "1", 200)
	if prefs["revision"].(float64) != 0 {
		t.Fatal("unexpected preferences")
	}
	call("PUT", "/preferences", map[string]any{"tags": []string{"react"}, "expected_revision": 0}, "1", 200)
	call("PUT", "/preferences", map[string]any{"tags": []string{"Other"}, "expected_revision": 0}, "1", 409)
	if call("GET", "/preferences", nil, "2", 200)["revision"].(float64) != 0 {
		t.Fatal("foreign interests leaked")
	}
	call("PUT", "/preferences", map[string]any{"tags": []string{"React", "react"}, "expected_revision": 1}, "1", 400)
	if len(call("GET", "/recommendations", nil, "1", 200)["items"].([]any)) == 0 {
		t.Fatal("case-insensitive recommendation missing")
	}
	// Ranking searches past the first feed page and still enforces private/block access.
	for i := 0; i < 25; i++ {
		copy := socialTestDocument()
		copy.Tags = []string{"Unrelated"}
		raw, _ := json.Marshal(copy)
		if err := db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES (?,1,'published',1,'public',?::jsonb,1,1,1)`, int64(9223372036854775000+i), string(raw)).Error; err != nil {
			t.Fatal(err)
		}
	}
	call("PUT", "/preferences", map[string]any{"tags": []string{"React"}, "expected_revision": 0}, "2", 200)
	recommended := call("GET", "/recommendations", nil, "2", 200)["items"].([]any)
	if len(recommended) != 1 {
		t.Fatal("recommendations exposed private posts", recommended)
	}
	if err := db.Exec("INSERT INTO user_relations VALUES (1,2,2)").Error; err != nil {
		t.Fatal(err)
	}
	if len(call("GET", "/recommendations", nil, "2", 200)["items"].([]any)) != 0 {
		t.Fatal("blocked work recommended")
	}
	db.Exec("DELETE FROM user_relations WHERE rel_type=2")
	// Stable proposal keys return the current draft without overwriting human edits.
	proposal := socialWriteRequest{Document: socialTestDocument(), Visibility: "public", IdempotencyKey: "work-unique"}
	first := call("POST", "/api/v2/social/drafts", proposal, "1", 201)
	second := call("POST", "/api/v2/social/drafts", proposal, "1", 201)
	if first["id"] != second["id"] {
		t.Fatal("proposal duplicated")
	}
	copy := proposal.Document
	copy.Title = "人类修改后的具体工作标题"
	call("PUT", "/drafts/"+first["id"].(string), socialWriteRequest{Document: copy, Visibility: "private", ExpectedRevision: 1}, "1", 200)
	retry := call("POST", "/api/v2/social/drafts", proposal, "1", 201)
	if retry["revision"].(float64) != 2 {
		t.Fatal("human edit overwritten")
	}
	proposal.Document.Title = "另一份工作结果"
	call("POST", "/api/v2/social/drafts", proposal, "1", 409)
	// Hosted media cannot be read or reused outside post permissions.
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	upload := map[string]any{"data": base64.StdEncoding.EncodeToString(imageData.Bytes()), "alt": "真实结果截图", "kind": "image"}
	media := call("POST", "/media", upload, "1", 201)
	mediaURL := media["url"].(string)
	mediaID := strings.TrimPrefix(mediaURL, socialMediaPrefix)
	readImage := func(viewer string, want int) {
		t.Helper()
		resp := ut.PerformRequest(h.Engine, "GET", "/media/"+mediaID, nil, ut.Header{Key: "Test-Viewer", Value: viewer})
		if resp.Code != want {
			t.Fatalf("image status %d want %d", resp.Code, want)
		}
		if want == 200 && (resp.Header().Get("Cache-Control") != "private, no-store" || !bytes.Equal(resp.Body.Bytes(), imageData.Bytes())) {
			t.Fatal("image data/cache incorrect")
		}
	}
	readImage("1", 200)
	readImage("2", 404)
	imageDoc := socialTestDocument()
	imageDoc.Media = []socialMedia{{URL: mediaURL, Alt: "真实结果截图", Kind: "image"}}
	call("POST", "/drafts", socialWriteRequest{Document: imageDoc, Visibility: "public"}, "2", 400)
	imagePost := call("POST", "/drafts", socialWriteRequest{Document: imageDoc, Visibility: "friends"}, "1", 201)
	readImage("2", 404)
	call("POST", "/posts/"+imagePost["id"].(string)+"/publish", map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true}, "1", 200)
	readImage("2", 200)
	db.Exec("INSERT INTO user_relations VALUES (2,1,2)")
	readImage("2", 404)
	db.Exec("DELETE FROM user_relations WHERE rel_type=2")
	call("DELETE", "/media/"+mediaID, nil, "1", 409)
	// A replay must still work after a human removes and deletes the original attachment.
	detachable := call("POST", "/media", upload, "1", 201)
	original := socialTestDocument()
	original.Media = []socialMedia{{URL: detachable["url"].(string), Alt: "可移除截图", Kind: "image"}}
	mediaProposal := socialWriteRequest{Document: original, Visibility: "private", IdempotencyKey: "removable-media-work"}
	proposedMedia := call("POST", "/api/v2/social/drafts", mediaProposal, "1", 201)
	revised := original
	revised.Media = []socialMedia{}
	call("PUT", "/drafts/"+proposedMedia["id"].(string), socialWriteRequest{Document: revised, Visibility: "private", ExpectedRevision: 1}, "1", 200)
	call("DELETE", "/media/"+strings.TrimPrefix(detachable["url"].(string), socialMediaPrefix), nil, "1", 200)
	replay := call("POST", "/api/v2/social/drafts", mediaProposal, "1", 201)
	if replay["revision"].(float64) != 2 {
		t.Fatal("edited draft replay failed after media removal")
	}
	orphan := call("POST", "/media", upload, "1", 201)
	unused := call("GET", "/media", nil, "1", 200)["items"].([]any)
	if len(unused) == 0 || unused[0].(map[string]any)["url"] != orphan["url"] {
		t.Fatal("unreferenced upload is not available for cleanup")
	}
	if len(call("GET", "/media", nil, "2", 200)["items"].([]any)) != 0 {
		t.Fatal("another Agent's uploads were exposed")
	}
	call("DELETE", "/media/"+strings.TrimPrefix(orphan["url"].(string), socialMediaPrefix), nil, "1", 200)
	upload["data"] = base64.StdEncoding.EncodeToString([]byte("<svg onload='evil()'/>"))
	call("POST", "/media", upload, "1", 400)
	review := call("GET", "/posts/"+first["id"].(string), nil, "1", 200)
	if review["reviewed_revision"].(float64) != 2 || len(review["quality"].([]any)) == 0 {
		t.Fatal("version-bound quality guidance missing")
	}

}

func TestSocialAgentShareAuthorizationAndRetry(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 9223372036854775500}}
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(1)); c.Next(ctx) }
	h.POST("/api/v2/social/share", inject, s.createSocialDraft)
	call := func(req socialWriteRequest, want int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(req)
		response := ut.PerformRequest(h.Engine, "POST", "/api/v2/social/share", &ut.Body{Body: strings.NewReader(string(data)), Len: len(data)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if response.Code != want {
			t.Fatalf("share got %d want %d: %s", response.Code, want, response.Body.String())
		}
		var result map[string]any
		json.Unmarshal(response.Body.Bytes(), &result)
		out, _ := result["data"].(map[string]any)
		return out
	}
	req := socialWriteRequest{Document: socialTestDocument(), Visibility: "public", IdempotencyKey: "share:mcp-test"}
	call(req, 400)
	req.OwnerAuthorized = true
	first := call(req, 201)
	retry := call(req, 201)
	if first["state"] != "published" || first["id"] != retry["id"] {
		t.Fatal("sharing was not published idempotently", first, retry)
	}
	if first["document"].(map[string]any)["identity"] != "agent" {
		t.Fatal("share did not use Agent identity")
	}
	req.Document.Title = "同一编号对应不同工作时不得重复发布"
	call(req, 409)
	req = socialWriteRequest{Document: socialTestDocument(), Visibility: "friends", IdempotencyKey: "share-command:701", OwnerAuthorized: true, CommandID: "701", ClaimToken: "proof", ClaimEpoch: 1}
	err := db.Exec(`INSERT INTO agent_commands(command_id,agent_id,command_type,payload,status,result,created_at,claim_epoch,claim_token_hash,claim_until) VALUES(701,1,'human_instruction','{"publish":false,"visibility":"friends"}','claimed','{}',1,1,?,?)`, hashString("proof"), time.Now().UnixMilli()+120000).Error
	if err != nil {
		t.Fatal(err)
	}
	call(req, 409)
	db.Exec(`UPDATE agent_commands SET payload='{"publish":true,"visibility":"public"}' WHERE command_id=701`)
	call(req, 409)
	db.Exec(`UPDATE agent_commands SET payload='{"publish":true,"visibility":"friends"}' WHERE command_id=701`)
	accepted := call(req, 201)
	db.Exec(`UPDATE agent_commands SET claim_until=0 WHERE command_id=701`)
	if call(req, 201)["id"] != accepted["id"] {
		t.Fatal("lost response retry duplicated published share")
	}
	req.IdempotencyKey = "share-command:702"
	req.CommandID = "702"
	call(req, 409)
}

func TestSocialAgentImageResize(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 9223372036854775600}}
	h := server.New()
	h.POST("/api/v2/social/media", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(1)); c.Next(ctx) }, s.uploadSocialMedia)
	img := image.NewRGBA(image.Rect(0, 0, 800, 800))
	rng := rand.New(rand.NewSource(42))
	rng.Read(img.Pix)
	var source bytes.Buffer
	png.Encode(&source, img)
	if source.Len() <= socialMediaMaxBytes {
		t.Fatal("fixture must exceed manual image limit")
	}
	data, _ := json.Marshal(map[string]any{"data": base64.StdEncoding.EncodeToString(source.Bytes()), "alt": "真实工作图像", "kind": "image"})
	resp := ut.PerformRequest(h.Engine, "POST", "/api/v2/social/media", &ut.Body{Body: bytes.NewReader(data), Len: len(data)}, ut.Header{Key: "Content-Type", Value: "application/json"})
	if resp.Code != 201 {
		t.Fatalf("automatic resize failed: %s", resp.Body.String())
	}
	var result struct{ Data socialMedia }
	json.Unmarshal(resp.Body.Bytes(), &result)
	var stored []byte
	db.Raw(`SELECT content FROM social_media WHERE media_id=?`, socialMediaID(result.Data.URL)).Row().Scan(&stored)
	if len(stored) == 0 || len(stored) > socialMediaMaxBytes {
		t.Fatal("stored image exceeds quota")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(stored))
	if err != nil || cfg.Width >= 800 {
		t.Fatal("image was not resized", err)
	}
}

func TestSocialRecommendationsRankAndPagination(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	db.Exec(`INSERT INTO agents VALUES(99,'推荐测试 Agent'),(100,'来源 Agent')`)
	defer func() {
		db.Exec(`DELETE FROM social_work_posts WHERE agent_id=100`)
		db.Exec(`DELETE FROM user_relations WHERE from_uid=99 OR to_uid=99`)
		db.Exec(`DELETE FROM social_preferences WHERE agent_id=99`)
		db.Exec(`DELETE FROM agents WHERE agent_id IN(99,100)`)
	}()
	db.Exec(`INSERT INTO social_preferences VALUES(99,'["论文"]',1)`)
	for i := 1; i <= 23; i++ {
		d := socialTestDocument()
		d.Title = fmt.Sprintf("排名专项工作记录%02d", i)
		d.Tags = []string{"其他工作"}
		if i <= 5 {
			d.Tags = []string{"论文"}
		}
		visibility := "public"
		if i == 23 {
			visibility = "private"
		}
		raw, _ := json.Marshal(d)
		if err := db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,100,'published',1,?,?::jsonb,1,?,1)`, 500000+i, visibility, string(raw), i).Error; err != nil {
			t.Fatal(err)
		}
	}
	s := &Service{db: db}
	h := server.New()
	h.GET("/posts", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(99)); c.Next(ctx) }, s.listSocialPosts)
	call := func(path string) map[string]any {
		t.Helper()
		r := ut.PerformRequest(h.Engine, "GET", path, nil)
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
		var e map[string]any
		json.Unmarshal(r.Body.Bytes(), &e)
		return e["data"].(map[string]any)
	}
	page := call("/posts?scope=recommended&q=排名专项")
	items := page["items"].([]any)
	if len(items) != 20 || len(items[0].(map[string]any)["matched_tags"].([]any)) != 1 {
		t.Fatal("profile interests did not rank first", page)
	}
	cursor := page["next_cursor"].(string)
	next := call("/posts?scope=recommended&q=排名专项&cursor=" + cursor)["items"].([]any)
	if len(next) != 2 {
		t.Fatal("ranked page lost or leaked posts", next)
	}
	seen := map[string]bool{}
	for _, v := range append(items, next...) {
		id := v.(map[string]any)["id"].(string)
		if seen[id] {
			t.Fatal("duplicate ranked page", id)
		}
		seen[id] = true
	}
	filtered := call(`/posts?scope=recommended&q=排名专项&tags=%5B%22论文%22%5D`)["items"].([]any)
	if len(filtered) != 5 {
		t.Fatal("ranked tag filter failed", filtered)
	}
	db.Exec(`INSERT INTO user_relations VALUES(100,99,2)`)
	if len(call("/posts?scope=recommended&q=排名专项")["items"].([]any)) != 0 {
		t.Fatal("ranking leaked blocked author")
	}
}
