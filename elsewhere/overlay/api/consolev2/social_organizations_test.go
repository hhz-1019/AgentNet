package consolev2

import (
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"os"
	"strings"
	"testing"
)

func TestSocialOrganizationConsentRolesAndRevocation(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("use test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 2000000000000000000}}
	defer db.Exec(`DELETE FROM social_work_posts WHERE post_id BETWEEN 2000000000000000000 AND 2000000000000000100`)
	defer db.Exec(`DELETE FROM social_organizations WHERE organization_id BETWEEN 2000000000000000000 AND 2000000000000000100`)
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		var id int64 = 1
		if string(c.GetHeader("Test-Viewer")) == "2" {
			id = 2
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	h.GET("/orgs", auth, s.getSocialOrganizations)
	h.POST("/orgs", auth, s.createSocialOrganization)
	h.PUT("/orgs/:organization_id/members/:member_id", auth, s.setSocialOrganizationMember)
	h.POST("/orgs/:organization_id/join", auth, s.joinSocialOrganization)
	h.POST("/drafts", auth, s.createSocialDraft)
	h.POST("/posts/:post_id/publish", auth, s.publishSocialPost)
	call := func(method, path string, body any, viewer string, want int) map[string]any {
		t.Helper()
		b, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(b)), Len: len(b)}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Test-Viewer", Value: viewer})
		if r.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, r.Code, want, r.Body.String())
		}
		var envelope map[string]any
		_ = json.Unmarshal(r.Body.Bytes(), &envelope)
		data, _ := envelope["data"].(map[string]any)
		return data
	}
	creation := map[string]any{"name": "授权测试团队", "idempotency_key": "organization-consent-test"}
	o := call("POST", "/orgs", creation, "1", 200)["items"].([]any)[0].(map[string]any)
	id := o["id"].(string)
	call("POST", "/orgs", creation, "1", 200)
	if len(call("GET", "/orgs", nil, "2", 200)["items"].([]any)) != 0 {
		t.Fatal("unrelated membership leaked")
	}
	member := "/orgs/" + id + "/members/2"
	join := "/orgs/" + id + "/join"
	change := func(role, action string, revision int) map[string]any {
		return map[string]any{"role": role, "action": action, "expected_revision": revision}
	}
	call("PUT", member, change("editor", "invite", 1), "2", 403)
	call("PUT", "/orgs/"+id+"/members/1", change("viewer", "revoke", 1), "1", 403)
	call("PUT", member, change("editor", "invite", 1), "1", 200)
	d := socialTestDocument()
	d.Identity = "project"
	d.ProjectName = "授权测试团队"
	d.OrganizationID = id
	call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, "2", 403)
	call("POST", join, map[string]any{"approved": true, "expected_revision": 1}, "2", 409)
	call("POST", join, map[string]any{"approved": true, "expected_revision": 2}, "2", 200)
	p := call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, "2", 201)
	postID := p["id"].(string)
	call("PUT", member, change("viewer", "revoke", 2), "1", 409)
	call("PUT", member, change("viewer", "revoke", 3), "1", 200)
	approval := map[string]any{"expected_revision": 1, "approved": true, "privacy_reviewed": true, "project_authorized": true}
	call("POST", "/posts/"+postID+"/publish", approval, "2", 403)
	call("PUT", member, change("viewer", "invite", 4), "1", 200)
	call("POST", join, map[string]any{"approved": true, "expected_revision": 5}, "2", 200)
	call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, "2", 403)
	call("PUT", member, change("editor", "invite", 6), "1", 200)
	// A change of role requires fresh acceptance, not a silent upgrade.
	call("POST", "/posts/"+postID+"/publish", approval, "2", 403)
	call("POST", join, map[string]any{"approved": true, "expected_revision": 7}, "2", 200)
	wrong := d
	wrong.ProjectName = "伪造名称"
	call("POST", "/drafts", socialWriteRequest{Document: wrong, Visibility: "public"}, "2", 403)
	call("POST", "/posts/"+postID+"/publish", approval, "2", 200)
	call("PUT", member, change("editor", "revoke", 8), "1", 200)
	call("POST", "/posts/"+postID+"/publish", approval, "2", 200) // historical same-revision retry
	call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "public"}, "2", 403)
	d.OrganizationID = "0"
	call("POST", "/drafts", socialWriteRequest{Document: d, Visibility: "private"}, "1", 400)
}
