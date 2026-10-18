package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestSocialAgentImageDraftRecovery(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:social:core")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 8809000010}}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(1)); c.Next(ctx) }
	h.POST("/drafts", auth, s.createSocialDraft)
	h.PUT("/drafts/:post_id", auth, s.updateSocialDraft)
	h.POST("/posts/:post_id/publish", auth, s.publishSocialPost)
	h.POST("/media", auth, s.uploadSocialMedia)
	h.GET("/media/:media_id", auth, s.getSocialMedia)
	call := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: bytes.NewReader(data), Len: len(data)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s got %d want %d: %s", path, r.Code, want, r.Body.String())
		}
		var response struct {
			Data map[string]any
			Code string
		}
		if err := json.Unmarshal(r.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if want == 422 && !strings.Contains(r.Body.String(), "POST_IMAGE_REQUIRED") {
			t.Fatal("missing image feedback", r.Body.String())
		}
		return response.Data
	}
	d := socialTestDocument()
	d.Identity = "agent"
	created := call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, 201)
	id := created["id"].(string)
	approval := map[string]any{"approved": true, "privacy_reviewed": true, "expected_revision": 1}
	call("POST", "/posts/"+id+"/publish", approval, 422)
	var state string
	if err := db.Raw("SELECT state FROM social_work_posts WHERE post_id=?", socialDecimal(id)).Scan(&state).Error; err != nil || state != "draft" {
		t.Fatal("failed publish lost draft", state, err)
	}
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 32, 32))); err != nil {
		t.Fatal(err)
	}
	media := call("POST", "/media", map[string]any{"data": base64.StdEncoding.EncodeToString(pixels.Bytes()), "kind": "image", "alt": "本轮准备的图片"}, 201)
	d.Media = []socialMedia{{URL: media["url"].(string), Kind: "image", Alt: "本轮准备的图片"}}
	call("PUT", "/drafts/"+id, socialWriteRequest{Document: d, Visibility: "public", ExpectedRevision: 1}, 200)
	approval["expected_revision"] = 2
	posted := call("POST", "/posts/"+id+"/publish", approval, 200)
	if posted["state"] != "published" {
		t.Fatal("repaired draft not published", posted)
	}
	if retry := call("POST", "/posts/"+id+"/publish", approval, 200); retry["id"] != id {
		t.Fatal("retry duplicated post")
	}
	r := ut.PerformRequest(h.Engine, "GET", "/media/"+strings.TrimPrefix(d.Media[0].URL, socialMediaPrefix), nil)
	if r.Code != 200 || len(r.Body.Bytes()) == 0 {
		t.Fatal("published image not readable", r.Code)
	}
	// Pre-existing text-only publications must still return their old receipt.
	if err := db.Exec("UPDATE social_work_posts SET document=jsonb_set(document,'{media}','[]') WHERE post_id=?", socialDecimal(id)).Error; err != nil {
		t.Fatal(err)
	}
	call("POST", "/posts/"+id+"/publish", approval, 200)
}
