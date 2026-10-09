package consolev2

import (
	"context"
	"encoding/base64"
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

func TestElsewherePortraitMessagingAndPublishing(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	if e := db.Exec(`INSERT INTO agents(agent_id,agent_name,bio) VALUES(201,'甲',''),(202,'乙',''),(203,'丙','');
 INSERT INTO human_accounts(uid,password_hash,recovery_hash,created_at) VALUES('ew-a','x','x',1),('ew-b','x','x',1);
 INSERT INTO agent_owners VALUES(201,'ew-a',1),(202,'ew-b',1);
 INSERT INTO console_v2_sessions VALUES('ew-session-a','ew-a','uid_password','active'),('ew-session-b','ew-b','uid_password','active');
 INSERT INTO user_relations VALUES(201,202,1),(202,201,1);`).Error; e != nil {
		t.Fatal(e)
	}
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 880000}}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		id := int64(201)
		if v := c.Query("viewer"); v != "" {
			id, _ = strconv.ParseInt(v, 10, 64)
		}
		c.Set("agent_id", id)
		if c.Query("agent") != "1" {
			session := "ew-session-a"
			if id == 202 {
				session = "ew-session-b"
			}
			if c.Query("handoff") == "1" {
				session = "invalid"
			}
			c.Set("console_session_id", session)
		}
		c.Next(ctx)
	}
	h.GET("/api/v2/console/portrait", auth, s.getPortrait)
	h.PUT("/api/v2/console/portrait", auth, s.putPortrait)
	h.PUT("/api/v2/agent-context/portrait", auth, s.putPortrait)
	h.GET("/people/:person_id", auth, s.getPerson)
	h.PUT("/people/:person_id/follow", auth, s.putFollow)
	h.POST("/api/v2/console/pm/send", auth, s.sendHumanPM)
	h.POST("/api/v2/console/groups", auth, s.createGroup)
	h.GET("/api/v2/console/groups", auth, s.listGroups)
	h.GET("/api/v2/console/groups/:group_id/messages", auth, s.groupMessages)
	h.POST("/api/v2/console/groups/:group_id/messages", auth, s.sendGroupMessage)
	h.POST("/api/v2/communication/groups/:group_id/messages", auth, s.sendGroupMessage)
	h.POST("/api/v2/console/social/share", auth, s.shareSocialPost)
	h.GET("/posts", auth, s.listSocialPosts)
	h.POST("/api/v2/console/social/upload", auth, s.uploadSocialAttachment)
	h.GET("/api/v2/console/social/media/:media_id", auth, s.getSocialMedia)
	call := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		b, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(b)), Len: len(b)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s %s = %d want %d: %s", method, path, r.Code, want, r.Body.String())
		}
		var result map[string]any
		if e := json.Unmarshal(r.Body.Bytes(), &result); e != nil {
			t.Fatal(e)
		}
		data, _ := result["data"].(map[string]any)
		return data
	}
	p := call("GET", "/api/v2/console/portrait", nil, 200)
	if p["revision"] != float64(0) {
		t.Fatal(p)
	}
	memories := []map[string]any{}
	for i := 1; i <= 61; i++ {
		memories = append(memories, map[string]any{"id": fmt.Sprintf("00000000-0000-4000-8000-%012d", i), "content": fmt.Sprintf("记忆%d", i), "showOnHome": i == 1})
	}
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 0, "fields": map[string]string{"name": "本人昵称", "bio": "公开介绍", "role": "私人身份"}, "visible": []string{"name", "bio"}, "upserts": memories}, 200)
	p = call("GET", "/api/v2/console/portrait", nil, 200)
	if len(p["memories"].([]any)) != 12 || p["total"] != float64(61) || p["next_cursor"] != "12" {
		t.Fatal("pagination", p)
	}
	p = call("GET", "/people/201?viewer=202", nil, 200)
	if _, exists := p["fields"].(map[string]any)["role"]; exists {
		t.Fatal("private field leaked")
	}
	if len(p["memories"].([]any)) != 1 {
		t.Fatal("private memories leaked")
	}
	call("GET", "/api/v2/console/portrait?handoff=1", nil, 403)
	call("PUT", "/api/v2/agent-context/portrait?agent=1", map[string]any{"expected_revision": 1, "fields": map[string]string{"name": "Agent 覆盖"}}, 409)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 0, "fields": map[string]string{"name": "陈旧版本"}}, 409)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 1, "upserts": []map[string]any{{"id": memories[0]["id"], "content": "只更新一条", "showOnHome": true}}}, 200)
	p = call("GET", "/api/v2/console/portrait", nil, 200)
	if p["total"] != float64(61) {
		t.Fatal("partial sync erased memories")
	}
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 2, "deletes": []any{memories[0]["id"]}}, 200)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 3, "upserts": []any{memories[0]}}, 200)
	p = call("GET", "/api/v2/console/portrait?q=记忆1", nil, 200)
	if p["total"] != float64(11) {
		t.Fatal("search/undo", p)
	}
	request := map[string]any{"receiver_id": "202", "content": "本人发出的真实私信", "idempotency_key": "pm-unique-request"}
	sent := call("POST", "/api/v2/console/pm/send", request, 201)
	again := call("POST", "/api/v2/console/pm/send", request, 201)
	if sent["msg_id"] != again["msg_id"] {
		t.Fatal("duplicate PM")
	}
	var actor string
	db.Raw(`SELECT actor_kind FROM private_messages WHERE msg_id=?`, sent["msg_id"]).Scan(&actor)
	if actor != "human" {
		t.Fatal("actor attribution")
	}
	request["content"] = "different"
	call("POST", "/api/v2/console/pm/send", request, 409)
	call("POST", "/api/v2/console/pm/send", map[string]any{"conv_id": sent["conv_id"], "content": "intruder", "idempotency_key": "intruder-request"}, 201) // owner is allowed
	request["receiver_id"] = "203"
	request["idempotency_key"] = "not-friends-request"
	call("POST", "/api/v2/console/pm/send", request, 403)
	groupReq := map[string]any{"name": "真实测试群", "members": []string{"202", "202", "201"}, "idempotency_key": "group-unique-request"}
	g := call("POST", "/api/v2/console/groups", groupReq, 201)
	gid := g["group_id"].(string)
	again = call("POST", "/api/v2/console/groups", groupReq, 201)
	if again["group_id"] != gid {
		t.Fatal("duplicate group")
	}
	p = call("GET", "/api/v2/console/groups", nil, 200)
	if len(p["items"].([]any)[0].(map[string]any)["members"].([]any)) != 2 {
		t.Fatal("duplicate member identity")
	}
	msgReq := map[string]any{"content": "本人群消息", "idempotency_key": "group-human-message"}
	call("POST", "/api/v2/console/groups/"+gid+"/messages", msgReq, 201)
	msgReq["content"] = "Agent 群消息"
	msgReq["idempotency_key"] = "group-agent-message"
	call("POST", "/api/v2/communication/groups/"+gid+"/messages?viewer=202&agent=1", msgReq, 201)
	p = call("GET", "/api/v2/console/groups/"+gid+"/messages", nil, 200)
	messages := p["messages"].([]any)
	if len(messages) != 2 || messages[0].(map[string]any)["actor_kind"] != "agent" || messages[1].(map[string]any)["actor_kind"] != "human" {
		t.Fatal("group actor/history", p)
	}
	call("GET", "/api/v2/console/groups/"+gid+"/messages?viewer=203", nil, 403)
	call("POST", "/api/v2/communication/groups/"+gid+"/messages?viewer=203&agent=1", msgReq, 403)
	// A minimal MP4 container signature exercises upload persistence and byte-range delivery.
	video := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0, 'm', 'p', '4', '2', 'i', 's', 'o', 'm'}
	upload := map[string]any{"data": base64.StdEncoding.EncodeToString(video), "kind": "video", "alt": "测试视频", "idempotency_key": "video-upload-request"}
	media := call("POST", "/api/v2/console/social/upload", upload, 201)
	if call("POST", "/api/v2/console/social/upload", upload, 201)["url"] != media["url"] {
		t.Fatal("duplicate attachment")
	}
	url := media["url"].(string)
	rangeRead := func(viewer, byteRange string, want int) {
		t.Helper()
		r := ut.PerformRequest(h.Engine, "GET", url+"?viewer="+viewer, nil, ut.Header{Key: "Range", Value: byteRange})
		if r.Code != want {
			t.Fatalf("media access/range: %d want %d: %s", r.Code, want, r.Body.String())
		}
		if want == 206 && (r.Body.Len() != 4 || string(r.Header().Get("Content-Range")) != "bytes 0-3/24") {
			t.Fatal("incorrect partial video", r.Body.Len())
		}
	}
	rangeRead("201", "bytes=0-3", 206)
	rangeRead("201", "bytes=99-", 416)
	rangeRead("202", "bytes=0-3", 404) // unshared upload is private
	call("POST", "/api/v2/console/social/share?viewer=202", map[string]any{"content": "", "media": []any{media}, "visibility": "public", "idempotency_key": "foreign-media-request"}, 403)
	post := map[string]any{"content": "一条普通动态", "media": []any{media}, "visibility": "friends", "idempotency_key": "direct-share-request"}
	published := call("POST", "/api/v2/console/social/share", post, 201)
	again = call("POST", "/api/v2/console/social/share", post, 201)
	if published["id"] != again["id"] {
		t.Fatal("duplicate social post")
	}
	rangeRead("202", "bytes=0-3", 206)
	rangeRead("203", "bytes=0-3", 404)
	p = call("GET", "/posts?scope=author:201&viewer=202", nil, 200)
	if len(p["items"].([]any)) != 1 {
		t.Fatal("friend post invisible")
	}
	p = call("GET", "/posts?scope=author:201&viewer=203", nil, 200)
	if len(p["items"].([]any)) != 0 {
		t.Fatal("friends post leaked")
	}
	call("PUT", "/people/201/follow?viewer=202", map[string]any{"following": true}, 200)
	p = call("GET", "/posts?scope=following&viewer=202", nil, 200)
	if len(p["items"].([]any)) != 1 {
		t.Fatal("following feed")
	}
	db.Exec(`INSERT INTO user_relations VALUES(202,201,2)`)
	call("POST", "/api/v2/console/pm/send", map[string]any{"conv_id": sent["conv_id"], "content": "blocked", "idempotency_key": "blocked-request"}, 403)
	p = call("GET", "/posts?scope=following&viewer=202", nil, 200)
	if len(p["items"].([]any)) != 0 {
		t.Fatal("blocked author leaked")
	}
	call("GET", "/people/201?viewer=202", nil, 404)
}
