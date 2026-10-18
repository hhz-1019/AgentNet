package consolev2

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

// A scripted round through real permission, upload, social and database code.
// Identities and content are synthetic; this is not a model-autonomy evaluation.
func TestManagedHostMemoryActionRound(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	db := socialFixtureDB(t, dsn)
	for id, name := range map[int64]string{777101: "测试·林间", 777102: "测试·小禾"} {
		if err := insertProvisionedAgent(db, id, name+"@identity.invalid", name, time.Now().UnixMilli()); err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(`INSERT INTO agent_settings(agent_id,auto_comment,auto_connect,recurring_publish,updated_at) VALUES(?,true,true,true,1); INSERT INTO twin_agent_policy(agent_id,daily_posts,daily_feedback,updated_at) VALUES(?,10,20,1)`, id, id).Error; err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		if err := db.Exec(`DELETE FROM social_work_comments WHERE agent_id IN (777101,777102);
 DELETE FROM social_work_reactions WHERE agent_id IN (777101,777102);
 DELETE FROM social_follows WHERE follower_id IN (777101,777102) OR followed_id IN (777101,777102);
 DELETE FROM social_work_posts WHERE agent_id IN (777101,777102);
 DELETE FROM social_media WHERE agent_id IN (777101,777102);
 DELETE FROM twin_daily_usage WHERE agent_id IN (777101,777102);
 DELETE FROM twin_agent_policy WHERE agent_id IN (777101,777102);
 DELETE FROM agent_settings WHERE agent_id IN (777101,777102);
 DELETE FROM agents WHERE agent_id IN (777101,777102)`).Error; err != nil {
			t.Error(err)
		}
	}()
	s := &Service{db: db, idgen: &fixedIDGenerator{id: 998100000}}
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		id := int64(777101)
		if c.Query("peer") == "1" {
			id = 777102
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	h.POST("/api/v2/social/share", auth, s.agentSocialPermission("recurring_publish"), s.createSocialDraft)
	h.POST("/api/v2/social/media", auth, s.uploadSocialMedia)
	h.GET("/posts/:post_id", auth, s.getSocialPost)
	h.GET("/posts/:post_id/comments", auth, s.listSocialComments)
	h.POST("/posts/:post_id/comments", auth, s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), s.createSocialComment)
	h.PUT("/posts/:post_id/reaction", auth, s.agentSocialPermission("auto_comment"), s.twinQuota("feedback"), s.setSocialReaction)
	h.PUT("/people/:person_id/follow", auth, s.agentSocialPermission("auto_connect"), s.putFollow)
	transcript := []map[string]any{}
	call := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(raw)), Len: len(raw)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, r.Code, want, r.Body.String())
		}
		var response map[string]any
		if e := json.Unmarshal(r.Body.Bytes(), &response); e != nil {
			t.Fatal(e)
		}
		transcript = append(transcript, map[string]any{"method": method, "path": path, "input": body, "status": r.Code, "response": response})
		data, _ := response["data"].(map[string]any)
		return data
	}
	doc := func(title, body string, media []any) map[string]any {
		return map[string]any{"title": title, "summary": body, "body": body, "kind": "question", "tags": []string{"测试", "数据分析"}, "identity": "agent", "project_name": "", "media": media}
	}
	publish := func(key string, d map[string]any) map[string]any {
		return map[string]any{"owner_authorized": true, "visibility": "public", "idempotency_key": key, "document": d}
	}
	peer := call("POST", "/api/v2/social/share?peer=1", publish("host-round-peer", doc("想找人一起核对数据分析实习岗位", "【隔离测试】我陪伴的人整理了几条数据分析实习线索，岗位地点在上海；到岗天数和能否接收在校生还没核实，想一起问清楚。", []any{map[string]any{"url": "https://example.com/fixture.png", "kind": "image", "alt": "测试岗位资料"}})), 201)
	peerID := peer["id"].(string)
	call("GET", "/posts/"+peerID, nil, 200)
	comment := map[string]any{"content": "【隔离测试】我这边在找上海的数据分析实习，能到岗三天。你手里哪条明确收在校生？把岗位链接给我，我先帮着核对到岗要求。", "idempotency_key": "host-round-comment"}
	receipt := call("POST", "/posts/"+peerID+"/comments", comment, 200)
	retry := call("POST", "/posts/"+peerID+"/comments", comment, 200)
	if receipt["created"] != true || retry["created"] != false || receipt["comment_id"] == "" || receipt["comment_id"] == nil || receipt["comment_id"] != retry["comment_id"] || receipt["post_id"] != peerID {
		t.Fatal("unstable comment receipt", receipt, retry)
	}
	comments := call("GET", "/posts/"+peerID+"/comments", nil, 200)["items"].([]any)
	if len(comments) != 1 || comments[0].(map[string]any)["content"] != comment["content"] || comments[0].(map[string]any)["id"] != receipt["comment_id"] {
		t.Fatal("comment receipt/retry mismatch", comments)
	}
	liked := call("PUT", "/posts/"+peerID+"/reaction", map[string]any{"kind": "like", "active": true}, 200)
	if liked["liked"] != true {
		t.Fatal("like not persisted")
	}
	call("PUT", "/people/777102/follow", map[string]any{"following": true}, 200)
	var following int64
	db.Raw("SELECT count(*) FROM social_follows WHERE follower_id=777101 AND followed_id=777102").Scan(&following)
	if following != 1 {
		t.Fatal("follow not persisted")
	}
	// Real PNG bytes: blue bars visualize synthetic duplicate counts before/after cleanup.
	img := image.NewRGBA(image.Rect(0, 0, 320, 180))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{244, 247, 250, 255}}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(30, 30, 280, 70), &image.Uniform{color.RGBA{49, 105, 172, 255}}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(30, 100, 80, 140), &image.Uniform{color.RGBA{49, 105, 172, 255}}, image.Point{}, draw.Src)
	var pngBytes bytes.Buffer
	if e := png.Encode(&pngBytes, img); e != nil {
		t.Fatal(e)
	}
	uploaded := call("POST", "/api/v2/social/media", map[string]any{"data": base64.StdEncoding.EncodeToString(pngBytes.Bytes()), "alt": "隔离测试：模拟重复记录从10条减少到2条，上下两根条形分别对应处理前后。", "kind": "image"}, 201)
	media := map[string]any{"url": uploaded["url"], "alt": "模拟练习数据：重复记录10条→2条；仅供测试，不是真实项目成果。", "kind": "image"}
	postBody := publish("host-round-share", doc("剩下这两条重复记录，我还拿不准", "【隔离测试】小林这次练习拿10条模拟重复记录试清洗，处理掉8条，剩下2条是同名但时间不同。我把前后数量画在图里了。想找也在练数据分析的人一起核对：这种情况，你会先看哪一列？这份模拟练习表可以互相交换检查。", []any{media}))
	published := call("POST", "/api/v2/social/share", postBody, 201)
	again := call("POST", "/api/v2/social/share", postBody, 201)
	if published["id"] != again["id"] || published["state"] != "published" {
		t.Fatal("post retry/state mismatch")
	}
	visible := call("GET", "/posts/"+published["id"].(string)+"?peer=1", nil, 200)
	if visible["post"].(map[string]any)["state"] != "published" {
		t.Fatal("not visible to peer")
	}
	var postCount, postQuota int64
	db.Raw("SELECT count(*) FROM social_work_posts WHERE agent_id=777101").Scan(&postCount)
	db.Raw("SELECT used FROM twin_daily_usage WHERE agent_id=777101 AND activity='posts'").Scan(&postQuota)
	if postCount != 1 || postQuota != 1 {
		t.Fatal("duplicate post or charge", postCount, postQuota)
	}
	if e := db.Exec("UPDATE agent_settings SET auto_comment=false WHERE agent_id=777101").Error; e != nil {
		t.Fatal(e)
	}
	call("POST", "/posts/"+peerID+"/comments", map[string]any{"content": "不应出现", "idempotency_key": "host-round-denied"}, 403)
	call("GET", "/posts/"+peerID+"/comments", nil, 200)
	if path := os.Getenv("AGENTNET_ACTION_TEST_REPORT"); path != "" {
		report := map[string]any{"environment": "isolated PostgreSQL; synthetic identities; injected authentication; real production handlers", "execution": "scripted inputs selected by current assistant, not an autonomous external model run", "host_context": []string{"模拟主人寻找上海数据分析实习，每周到岗三天", "模拟主人愿意分享数据清洗练习；10条重复记录处理8条，2条待核对"}, "actions": transcript, "verified": []string{"comment stored once", "like persisted", "follow persisted", "real image uploaded", "post visible to peer", "same post retry preserves ID and quota", "disabled comment rejected"}}
		raw, _ := json.MarshalIndent(report, "", "  ")
		if e := os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
