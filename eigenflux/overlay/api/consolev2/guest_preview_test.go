package consolev2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestElsewhereGuestPreviewAccess(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("requires isolated social PostgreSQL fixture")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name,identity_state) VALUES(88001,'公开访客测试','active'),(88002,'已归档','managed_archived')`).Error)
	defer db.Exec(`DELETE FROM agents WHERE agent_id IN (88001,88002)`)
	check(db.Exec(`INSERT INTO social_media(media_id,agent_id,content,content_type,created_at) VALUES(88101,88001,decode('010203','hex'),'image/png',1),(88102,88001,decode('040506','hex'),'image/png',1),(88103,88002,decode('070809','hex'),'image/png',1)`).Error)
	insert := func(id, agent int, visibility, state string, media int) {
		d := socialTestDocument()
		d.Summary = strings.Repeat("预览", 100)
		d.Body = "正文不应出现在访客接口"
		d.Source = "内部来源不应出现"
		d.Media = []socialMedia{{URL: fmt.Sprintf("%s%d", socialMediaPrefix, media), Kind: "image", Alt: "封面"}, {URL: socialMediaPrefix + "88102", Kind: "image", Alt: "内页"}}
		b, _ := json.Marshal(d)
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,?, ?,?::jsonb,1,1,1)`, id, agent, state, visibility, string(b)).Error)
	}
	insert(88201, 88001, "public", "published", 88101)
	insert(88202, 88001, "friends", "published", 88102)
	insert(88203, 88001, "private", "published", 88102)
	insert(88204, 88001, "public", "draft", 88102)
	insert(88205, 88002, "public", "published", 88103)
	defer db.Exec(`DELETE FROM social_work_posts WHERE agent_id IN (88001,88002)`)
	defer db.Exec(`DELETE FROM social_media WHERE agent_id IN (88001,88002)`)
	h := server.New()
	s := &Service{db: db}
	h.GET("/feed", s.getGuestFeed)
	h.GET("/posts/:post_id/cover", s.getGuestCover)
	response := ut.PerformRequest(h.Engine, http.MethodGet, "/feed", nil).Result()
	if response.StatusCode() != 200 {
		t.Fatal(string(response.Body()))
	}
	var result struct {
		Data struct {
			Items []guestPost `json:"items"`
		} `json:"data"`
	}
	check(json.Unmarshal(response.Body(), &result))
	found := false
	for _, p := range result.Data.Items {
		if p.ID == "88201" {
			found = true
			if len([]rune(p.Excerpt)) != 91 || p.Cover != "/api/v2/guest/posts/88201/cover" {
				t.Fatalf("bad preview: %+v", p)
			}
		}
		if p.ID == "88202" || p.ID == "88203" || p.ID == "88204" || p.ID == "88205" {
			t.Fatal("non-public post exposed", p.ID)
		}
	}
	if !found || strings.Contains(string(response.Body()), "正文不应") || strings.Contains(string(response.Body()), "内部来源") || strings.Contains(string(response.Body()), "agent_id") {
		t.Fatal("invalid public projection", string(response.Body()))
	}
	for _, id := range []string{"88202", "88203", "88204", "88205", "999999", "bad"} {
		if r := ut.PerformRequest(h.Engine, http.MethodGet, "/posts/"+id+"/cover", nil).Result(); r.StatusCode() != 404 {
			t.Fatal("private cover accessible", id, r.StatusCode())
		}
	}
	cover := ut.PerformRequest(h.Engine, http.MethodGet, "/posts/88201/cover", nil).Result()
	if cover.StatusCode() != 200 || string(cover.Body()) != "\x01\x02\x03" || string(cover.Header.Peek("Cache-Control")) != "no-store" {
		t.Fatal("public cover mismatch")
	}
	check(db.Exec(`UPDATE social_work_posts SET visibility='friends' WHERE post_id=88201`).Error)
	if r := ut.PerformRequest(h.Engine, http.MethodGet, "/posts/88201/cover", nil).Result(); r.StatusCode() != 404 {
		t.Fatal("scope revocation ignored")
	}
}
