package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestMomentInboxReceiptIsolationAndPaging(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	must := func(sql string, args ...any) {
		t.Helper()
		if e := db.Exec(sql, args...).Error; e != nil {
			t.Fatal(e)
		}
	}
	now := time.Now().UnixMilli()
	must(`INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,msg_count,status,updated_at) VALUES(70001,1,2,2,2,4,0,?), (70002,2,3,2,2,1,0,?), (70003,1,3,3,3,1,1,?)`, now, now, now)
	must(`INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(70101,70001,2,1,?,?),(70102,70001,1,2,'outbound',?),(70103,70002,2,3,'other account',?),(70104,70003,3,1,'closed conversation',?)`, strings.Repeat("真实收件", 400), now, now, now, now)
	must(`INSERT INTO social_groups VALUES(70001,'测试群',2,?,?); INSERT INTO social_group_members VALUES(70001,1,0),(70001,2,0); INSERT INTO social_group_messages VALUES(70101,70001,2,'agent','收到的群消息',?),(70102,70001,1,'human','自己发送',?)`, now, now, now, now)
	must(`INSERT INTO friend_requests VALUES(70101,2,1,0,'真实申请',?,?),(70102,3,1,1,'已处理',?,?)`, now, now, now, now)
	must(`INSERT INTO raw_items VALUES(70101,2,'已经投递的广播',?),(70102,2,'未投递的广播',?),(70103,2,'已撤下的广播',?); INSERT INTO processed_items VALUES(70101,3),(70102,3),(70103,4)`, now, now, now)
	// Use the real Feed projection writer, rather than inventing a Moment item.
	e := persistFeedExposures(db, 1, []frozenFeedItem{{SourceType: "broadcast", SourceID: 70101, Payload: map[string]interface{}{"content_class": "ugc", "author_identity": map[string]interface{}{"agent_id": "2"}}}, {SourceType: "broadcast", SourceID: 70103, Payload: map[string]interface{}{"content_class": "ugc"}}}, nil, now)
	if e != nil {
		t.Fatal(e)
	}
	s := &Service{db: db}
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) {
		id := int64(1)
		if string(c.GetHeader("Test-Viewer")) == "3" {
			id = 3
		}
		c.Set("agent_id", id)
		c.Next(ctx)
	}
	h.GET("/inbox", inject, s.listMomentInbox)
	h.GET("/inbox/:kind/:source_id", inject, s.momentInboxItem)
	h.POST("/inbox/:kind/:source_id/view", inject, s.momentInboxItem)
	call := func(method, path, viewer string, want int) map[string]any {
		t.Helper()
		r := ut.PerformRequest(h.Engine, method, path, nil, ut.Header{Key: "Test-Viewer", Value: viewer}).Result()
		if r.StatusCode() != want {
			t.Fatalf("%s got %d: %s", path, r.StatusCode(), r.Body())
		}
		if string(r.Header.Peek("Cache-Control")) != "private, no-store" {
			t.Fatal("private inbox response must not be cached")
		}
		var out map[string]any
		if json.Unmarshal(r.Body(), &out) != nil {
			t.Fatal("bad JSON")
		}
		data, _ := out["data"].(map[string]any)
		return data
	}
	page := call("GET", "/inbox", "1", 200)
	rows := page["items"].([]any)
	if len(rows) != 5 {
		t.Fatalf("want 4 received sources and 1 outgoing message, got %v", rows)
	}
	for _, kind := range []string{"private_message", "group_message", "friend_request", "broadcast"} {
		detail := call("GET", "/inbox/"+kind+"/70101", "1", 200)["item"].(map[string]any)
		if detail["kind"] != kind || detail["viewed_at"] != nil {
			t.Fatal(detail)
		}
		if kind == "private_message" && len([]rune(detail["body"].(string))) != 1600 {
			t.Fatal("detail was truncated to preview")
		}
		call("GET", "/inbox/"+kind+"/70101", "3", 404)
		call("POST", "/inbox/"+kind+"/70101/view", "3", 404)
		call("POST", "/inbox/"+kind+"/70101/view", "1", 200)
	}
	var consumed bool
	db.Raw("SELECT is_read FROM private_messages WHERE msg_id=70101").Scan(&consumed)
	if consumed {
		t.Fatal("owner viewing consumed Agent PM inbox")
	}
	var readID int64
	db.Raw("SELECT read_message_id FROM social_group_members WHERE group_id=70001 AND agent_id=1").Scan(&readID)
	if readID != 0 {
		t.Fatal("owner viewing consumed group cursor")
	}
	var count int64
	db.Raw("SELECT seen_count FROM agent_feed_exposures WHERE agent_id=1 AND source_id=70101").Scan(&count)
	if count != 1 {
		t.Fatal("Moment repolled Agent feed")
	}
	call("GET", "/inbox/broadcast/70102", "1", 404)
	call("GET", "/inbox/broadcast/70103", "1", 404)
	call("GET", "/inbox?cursor=invalid", "1", 400)
	call("GET", "/inbox/unknown/70101", "1", 400)
	// A comment joins the two participating accounts, not every reader of a post.
	must(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision)
 VALUES(72001,1,'published','public','{"title":"我方的帖子","body":"原文一"}',?,?,1),
 (72002,2,'published','public','{"title":"对方的帖子","body":"原文二"}',?,?,1),
 (72003,2,'published','friends','{"title":"好友帖子"}',?,?,1);
 INSERT INTO social_work_comments VALUES(72101,72001,2,'对方给我方的评论','moment-comment-in',?),
 (72102,72002,1,'我方给对方的评论','moment-comment-out',?),
 (72103,72002,3,'第三方路过评论','moment-comment-unrelated',?),
 (72104,72003,1,'过去的好友评论','moment-comment-friends',?)`, now, now, now, now, now, now, now, now, now, now)
	for _, id := range []string{"72101", "72102"} {
		detail := call("GET", "/inbox/post_comment/"+id, "1", 200)["item"].(map[string]any)
		if detail["agent_id"] != "2" || detail["context_title"] == "" || detail["post_id"] == nil {
			t.Fatal("comment lost counterpart/post context", detail)
		}
		if (id == "72102") != (detail["direction"] == "outgoing") {
			t.Fatal("wrong comment direction", detail)
		}
		call("POST", "/inbox/post_comment/"+id+"/view", "1", 200)
	}
	call("GET", "/inbox/post_comment/72101", "3", 404)
	call("GET", "/inbox/post_comment/72103", "1", 404)
	call("GET", "/inbox/post_comment/72104", "1", 404)
	must("INSERT INTO user_relations VALUES(1,2,1)")
	call("GET", "/inbox/post_comment/72104", "1", 200)
	must("DELETE FROM user_relations WHERE from_uid=1 AND to_uid=2 AND rel_type=1")
	call("POST", "/inbox/post_comment/72104/view", "1", 404)
	must("UPDATE social_work_posts SET visibility='private' WHERE post_id=72002")
	call("GET", "/inbox/post_comment/72102", "1", 404)
	call("POST", "/inbox/post_comment/72102/view", "1", 404)
	// A received broadcast mirrored as a post must honor the post's current visibility.
	must(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision)
 VALUES(70101,2,'published','private','{"title":"已转为私密的帖子"}',?,?,1)`, now, now)
	call("GET", "/inbox/broadcast/70101", "1", 404)
	must("UPDATE social_work_posts SET visibility='public' WHERE post_id=70101")
	post := call("GET", "/inbox/broadcast/70101", "1", 200)["item"].(map[string]any)
	if post["post_id"] != "70101" {
		t.Fatal("received post cannot link to original", post)
	}
	must("INSERT INTO user_relations VALUES(2,1,2)")
	if len(call("GET", "/inbox", "1", 200)["items"].([]any)) != 0 {
		t.Fatal("blocked sender leaked")
	}
	call("GET", "/inbox/private_message/70101", "1", 404)
	call("POST", "/inbox/private_message/70101/view", "1", 404)
	call("GET", "/inbox/post_comment/72101", "1", 404)
	must("DELETE FROM user_relations WHERE from_uid=2 AND to_uid=1 AND rel_type=2")
	must("DELETE FROM social_work_comments WHERE comment_id BETWEEN 72101 AND 72104; DELETE FROM social_work_posts WHERE post_id IN(70101,72001,72002,72003)")
	must("DELETE FROM social_group_members WHERE group_id=70001 AND agent_id=1")
	call("GET", "/inbox/group_message/70101", "1", 404)
	// Equal timestamps and overlapping IDs across kinds must page without loss.
	for n := 0; n < 55; n++ {
		must("INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,created_at) VALUES(?,70001,2,1,'分页消息',?)", 71000+n, now)
	}
	first := call("GET", "/inbox", "1", 200)
	seen := map[string]bool{}
	for _, raw := range first["items"].([]any) {
		m := raw.(map[string]any)
		seen[fmt.Sprint(m["kind"], m["id"])] = true
	}
	second := call("GET", "/inbox?cursor="+first["next_cursor"].(string), "1", 200)
	for _, raw := range second["items"].([]any) {
		m := raw.(map[string]any)
		key := fmt.Sprint(m["kind"], m["id"])
		if seen[key] {
			t.Fatal("duplicate cursor item")
		}
		seen[key] = true
	}
	if len(seen) != 59 || second["next_cursor"] != "" {
		t.Fatalf("paging lost sources: %d", len(seen))
	}
}
