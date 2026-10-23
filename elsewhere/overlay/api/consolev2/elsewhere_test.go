package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
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
	h.GET("/api/v2/console/avatars", auth, s.getAvatars)
	h.GET("/api/v2/console/portrait", auth, s.getPortrait)
	h.GET("/api/v2/console/portrait/export", auth, s.exportLegacyProfile)
	h.PUT("/api/v2/console/portrait", auth, s.putPortrait)
	h.PUT("/api/v2/agent-context/portrait", auth, s.putPortrait)
	h.GET("/people/:person_id", auth, s.getPerson)
	h.PUT("/people/:person_id/follow", auth, s.putFollow)
	h.POST("/api/v2/console/pm/send", auth, s.sendHumanPM)
	h.POST("/api/v2/console/pm/conversations/:conv_id/read", auth, s.readHumanPM)
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
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 0, "fields": map[string]string{"name": "本人昵称", "bio": "公开介绍", "interests": "画画", "connections": "找一起画画的人", "avatar": "citrus"}, "visible": []string{"name", "bio"}}, 200)
	// Seed a pre-upgrade archive; normal reads must not expose it, export must preserve it.
	if e := db.Exec(`INSERT INTO portrait_memories(user_id,memory_id,content,show_on_home,edited_by,created_at,updated_at) VALUES('ew-a','00000000-0000-4000-8000-000000000001','旧的私人经历',true,'human',1,1);INSERT INTO legacy_profile_archives SELECT user_id,to_jsonb(u),1 FROM twin_users u WHERE user_id='ew-a'`).Error; e != nil {
		t.Fatal(e)
	}
	p = call("GET", "/api/v2/console/portrait", nil, 200)
	if len(p["memories"].([]any)) != 0 || p["total"] != float64(0) {
		t.Fatal("archive leaked", p)
	}
	exported := call("GET", "/api/v2/console/portrait/export", nil, 200)
	if len(exported["portrait_memories"].([]any)) != 1 {
		t.Fatal("archive missing", exported)
	}
	other := call("GET", "/api/v2/console/portrait/export?viewer=202", nil, 200)
	if len(other["portrait_memories"].([]any)) != 0 {
		t.Fatal("other owner archive leaked")
	}
	call("GET", "/api/v2/console/portrait/export?handoff=1", nil, 403)
	call("GET", "/api/v2/console/portrait/export?agent=1", nil, 403)
	avatars := call("GET", "/api/v2/console/avatars?ids=201,202&viewer=202", nil, 200)["avatars"].(map[string]any)
	if avatars["201"] != "citrus" || avatars["202"] != "" {
		t.Fatal("saved/default avatars", avatars)
	}
	call("GET", "/api/v2/console/avatars?ids=invalid", nil, 400)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 1, "fields": map[string]string{"avatar": "https://example.com/avatar.svg"}}, 400)
	call("PUT", "/api/v2/agent-context/portrait?agent=1", map[string]any{"expected_revision": 1, "fields": map[string]string{"avatar": "tide"}}, 409)
	p = call("GET", "/people/201?viewer=202", nil, 200)
	if p["fields"].(map[string]any)["avatar"] != "citrus" {
		t.Fatal("public avatar missing", p)
	}
	if _, exists := p["fields"].(map[string]any)["role"]; exists {
		t.Fatal("private field leaked")
	}
	if len(p["memories"].([]any)) != 0 {
		t.Fatal("public archive leaked")
	}
	call("GET", "/api/v2/console/portrait?handoff=1", nil, 403)
	call("PUT", "/api/v2/agent-context/portrait?agent=1", map[string]any{"expected_revision": 1, "fields": map[string]string{"name": "Agent 覆盖"}}, 409)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 0, "fields": map[string]string{"name": "陈旧版本"}}, 409)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 1, "upserts": []any{map[string]string{"content": "新记忆"}}}, 409)
	call("PUT", "/api/v2/console/portrait", map[string]any{"expected_revision": 1, "deletes": []string{"00000000-0000-4000-8000-000000000001"}}, 409)
	call("PUT", "/api/v2/agent-context/portrait?agent=1", map[string]any{"expected_revision": 1, "fields": map[string]string{"connections": "擅改目标"}}, 403)
	var retained int64
	db.Raw("SELECT count(*) FROM portrait_memories WHERE user_id='ew-a' AND NOT deleted").Scan(&retained)
	if retained != 1 {
		t.Fatal("legacy archive deleted")
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
	readPath := "/api/v2/console/pm/conversations/" + sent["conv_id"].(string) + "/read"
	receipt := map[string]any{"through_message_id": sent["msg_id"]}
	call("POST", readPath+"?viewer=203", receipt, 404)
	call("POST", readPath+"?viewer=202", map[string]any{"through_message_id": "invalid"}, 400)
	call("POST", readPath+"?viewer=202", map[string]any{"through_message_id": "999999999999999999"}, 404)
	newer := call("POST", "/api/v2/console/pm/send", map[string]any{"receiver_id": "202", "content": "arrived after the displayed page", "idempotency_key": "pm-read-newer"}, 201)
	if read := call("POST", readPath, receipt, 200); read["read_count"] != float64(0) {
		t.Fatal("sender must not mark recipient messages read", read)
	}
	if read := call("POST", readPath+"?viewer=202", receipt, 200); read["read_count"] != float64(1) {
		t.Fatal("recipient read receipt", read)
	}
	if read := call("POST", readPath+"?viewer=202", receipt, 200); read["read_count"] != float64(0) {
		t.Fatal("read receipt must be idempotent", read)
	}
	var newerRead bool
	db.Raw(`SELECT is_read FROM private_messages WHERE msg_id=?`, newer["msg_id"]).Scan(&newerRead)
	if newerRead {
		t.Fatal("read receipt swallowed a newer unread message")
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
	post := map[string]any{"title": "周末的散步", "tags": []string{"日常", "散步"}, "content": "一条普通动态", "media": []any{media}, "visibility": "friends", "idempotency_key": "direct-share-request"}
	invalid := map[string]any{"content": "测试正文", "tags": []string{"重复", "重复"}, "visibility": "public", "idempotency_key": "invalid-tags-request"}
	call("POST", "/api/v2/console/social/share", invalid, 400)
	invalid["tags"] = []string{strings.Repeat("字", 31)}
	call("POST", "/api/v2/console/social/share", invalid, 400)
	invalid["tags"] = []string{"一", "二", "三", "四", "五", "六", "七", "八", "九"}
	call("POST", "/api/v2/console/social/share", invalid, 400)
	invalid["tags"] = []string{}
	invalid["title"] = strings.Repeat("字", 101)
	call("POST", "/api/v2/console/social/share", invalid, 400)
	published := call("POST", "/api/v2/console/social/share", post, 201)
	document := published["document"].(map[string]any)
	if document["title"] != "周末的散步" || document["body"] != "一条普通动态" || len(document["tags"].([]any)) != 2 {
		t.Fatal("title, body or tags were not preserved", document)
	}
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
