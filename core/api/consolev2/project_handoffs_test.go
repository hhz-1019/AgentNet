package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestSocialProjectHandoffPrivacyDurabilityAndAcknowledgement(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL fixture")
	}
	db := socialFixtureDB(t, dsn)
	t.Cleanup(func() { db.Exec("DELETE FROM project_handoffs; DELETE FROM user_relations") })
	if e := db.Exec("DELETE FROM user_relations; DELETE FROM project_handoffs; INSERT INTO user_relations VALUES(1,2,1),(2,1,1)").Error; e != nil {
		t.Fatal(e)
	}
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 9007199254740993}}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		id, _ := strconv.ParseInt(string(c.GetHeader("Viewer")), 10, 64)
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	h.POST("/handoffs", auth, s.sendProjectHandoff)
	h.GET("/handoffs", auth, s.listProjectHandoffs)
	h.GET("/handoffs/:handoff_id", auth, s.getProjectHandoff)
	h.POST("/handoffs/:handoff_id/acknowledge", auth, s.acknowledgeProjectHandoff)
	call := func(method, path, viewer string, body any, status int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		resp := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(data)), Len: len(data)}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Viewer", Value: viewer})
		if resp.Code != status {
			t.Fatalf("%s %s as %s: got %d want %d: %s", method, path, viewer, resp.Code, status, resp.Body.String())
		}
		var result map[string]any
		_ = json.Unmarshal(resp.Body.Bytes(), &result)
		out, _ := result["data"].(map[string]any)
		return out
	}
	req := projectHandoffRequest{ReceiverID: "2", Title: "交接一个真实项目", Summary: "请先看说明，由你决定何时继续。", Markdown: "# 项目\n目标、已完成工作、待办、验收方法与缺少的材料。", Sources: []string{"https://example.com/project"}, IdempotencyKey: "handoff-original", OwnerAuthorized: true}
	var before int64
	db.Raw("SELECT count(*) FROM agent_commands").Scan(&before)
	first := call("POST", "/handoffs", "1", req, 201)
	id := first["id"].(string)
	if id != "9007199254740994" || first["execution_authorized"] != false {
		t.Fatal(first)
	}
	if retry := call("POST", "/handoffs", "1", req, 200); retry["id"] != id || retry["created"] != false {
		t.Fatal(retry)
	}
	changed := req
	changed.Markdown = "changed"
	call("POST", "/handoffs", "1", changed, 409)
	for i := 0; i < 2; i++ {
		inbox := call("GET", "/handoffs", "2", nil, 200)
		if len(inbox["items"].([]any)) != 1 {
			t.Fatal("read consumed pending handoff")
		}
		detail := call("GET", "/handoffs/"+id, "2", nil, 200)
		if detail["markdown"] != req.Markdown {
			t.Fatal(detail)
		}
	}
	if len(call("GET", "/handoffs", "3", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("third party inbox leak")
	}
	call("GET", "/handoffs/"+id, "3", nil, 404)
	call("POST", "/handoffs/"+id+"/acknowledge", "1", map[string]bool{"owner_acknowledged": true}, 404)
	call("POST", "/handoffs/"+id+"/acknowledge", "3", map[string]bool{"owner_acknowledged": true}, 404)
	call("POST", "/handoffs/"+id+"/acknowledge", "2", map[string]bool{"owner_acknowledged": false}, 400)
	call("POST", "/handoffs/"+id+"/acknowledge", "2", map[string]bool{"owner_acknowledged": true}, 200)
	call("POST", "/handoffs/"+id+"/acknowledge", "2", map[string]bool{"owner_acknowledged": true}, 200)
	if len(call("GET", "/handoffs", "2", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("acknowledged item still pending")
	}
	if call("GET", "/handoffs/"+id, "2", nil, 200)["state"] != "acknowledged" {
		t.Fatal("lost acknowledged message")
	}
	// Reading does not grant execution, and even acknowledging never enqueues work.
	var after int64
	db.Raw("SELECT count(*) FROM agent_commands").Scan(&after)
	if before != after {
		t.Fatal("handoff created an executable command")
	}
	noAuth := req
	noAuth.OwnerAuthorized = false
	call("POST", "/handoffs", "1", noAuth, 400)
	noFriend := req
	noFriend.ReceiverID = "3"
	call("POST", "/handoffs", "1", noFriend, 403)
	secret := req
	secret.Markdown = "api_key=abcdefghijk12345"
	call("POST", "/handoffs", "1", secret, 400)
	local := req
	local.Sources = []string{"file:///C:/private.md"}
	call("POST", "/handoffs", "1", local, 400)
	if e := db.Exec("INSERT INTO user_relations VALUES(2,1,2)").Error; e != nil {
		t.Fatal(e)
	}
	call("POST", "/handoffs", "1", req, 403)
	call("GET", "/handoffs/"+id, "2", nil, 404)
	if len(call("GET", "/handoffs?direction=sent&state=all", "1", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("blocked item visible")
	}
	db.Exec("DELETE FROM user_relations WHERE rel_type=2")
	for i := 0; i < 22; i++ {
		req.IdempotencyKey = fmt.Sprintf("page-%d", i)
		call("POST", "/handoffs", "1", req, 201)
	}
	firstPage := call("GET", "/handoffs", "2", nil, 200)
	if len(firstPage["items"].([]any)) != 20 {
		t.Fatal("invalid page size")
	}
	secondPage := call("GET", "/handoffs?cursor="+firstPage["next_cursor"].(string), "2", nil, 200)
	if len(secondPage["items"].([]any)) != 2 || secondPage["next_cursor"] != "" {
		t.Fatal("lost paginated handoffs")
	}
	call("GET", "/handoffs?direction=other", "2", nil, 400)
	call("GET", "/handoffs?cursor=no", "2", nil, 400)
}
