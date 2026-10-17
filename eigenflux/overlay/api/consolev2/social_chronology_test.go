package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"sort"
	"strconv"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestElsewhereChronologicalFeedPagination(t *testing.T) {
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
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name,identity_state) VALUES(88777,'时间排序测试','active')`).Error)
	defer db.Exec(`DELETE FROM agents WHERE agent_id=88777`)
	defer db.Exec(`DELETE FROM social_work_posts WHERE agent_id=88777`)
	type post struct{ id, at int64 }
	posts := []post{{724157482699473211, 1}}
	for i := int64(0); i < 49; i++ {
		posts = append(posts, post{887770 + i, 10000 - i/2})
	}
	doc := socialTestDocument()
	doc.Title = "排序时间回归"
	raw, _ := json.Marshal(doc)
	for _, p := range posts {
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision) VALUES(?,88777,'published','public',?::jsonb,?, ?,1)`, p.id, string(raw), 20000-p.at, p.at).Error)
	}
	sort.Slice(posts, func(i, j int) bool {
		if posts[i].at == posts[j].at {
			return posts[i].id > posts[j].id
		}
		return posts[i].at > posts[j].at
	})
	want := []string{}
	for _, p := range posts {
		want = append(want, strconv.FormatInt(p.id, 10))
	}
	s := &Service{db: db}
	h := server.New()
	h.GET("/posts", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(88777)); c.Next(ctx) }, s.listSocialPosts)
	h.GET("/guest", s.getGuestFeed)
	type page struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		Cursor string `json:"next_cursor"`
	}
	read := func(path string) page {
		t.Helper()
		r := ut.PerformRequest(h.Engine, "GET", path, nil).Result()
		if r.StatusCode() != 200 {
			t.Fatalf("%s: %d %s", path, r.StatusCode(), r.Body())
		}
		var data struct {
			Data page `json:"data"`
		}
		check(json.Unmarshal(r.Body(), &data))
		return data.Data
	}
	for _, path := range []string{"/posts?scope=public", "/guest?scope=latest"} {
		path += "&q=" + url.QueryEscape(doc.Title)
		got := []string{}
		cursor := ""
		first := read(path)
		for n := 0; n < 5; n++ {
			p := read(path + "&cursor=" + url.QueryEscape(cursor))
			for _, item := range p.Items {
				got = append(got, item.ID)
			}
			cursor = p.Cursor
			if cursor == "" {
				break
			}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: incorrect order or pagination: %v", path, got)
		}
		// Cursors from tabs opened before the deployment still use the ID.
		legacy := first.Items[len(first.Items)-1].ID
		if path[:6] == "/guest" {
			legacy = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("latest:0:%s", legacy)))
		}
		next := read(path + "&cursor=" + url.QueryEscape(legacy))
		if len(next.Items) == 0 || next.Items[0].ID != want[len(first.Items)] {
			t.Fatal("legacy cursor lost chronological position")
		}
	}
}
