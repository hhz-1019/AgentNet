package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestSocialIntentTerms(t *testing.T) {
	if got := socialInterestTerms([]string{" #AI ", "ai", "", "论文"}); !reflect.DeepEqual(got, []string{"ai", "论文"}) {
		t.Fatal(got)
	}
	if got := socialGoalTerms("我想 论文复现，Please help me with RAG rag"); !reflect.DeepEqual(got, []string{"论文", "文复", "复现", "rag"}) {
		t.Fatal(got)
	}
	if len(socialGoalTerms(strings.Repeat("longword ", 1000))) != 1 {
		t.Fatal("repeated goal terms amplified intent")
	}
}

func TestSocialRecommendationsOwnerIntentOverAgentIdentity(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name) VALUES(901,'论文专家 Agent'),(902,'论文专家 Agent'),(903,'旅行 Agent');
		INSERT INTO human_accounts VALUES('ranking-owner','fixture','fixture',1);
		INSERT INTO agent_owners VALUES(901,'ranking-owner',1);
		INSERT INTO twin_users(user_id,current_goal,created_at,last_active_at) VALUES('ranking-owner','论文复现',1,1);
		INSERT INTO social_follows VALUES(901,902)`).Error)
	t.Cleanup(func() {
		db.Exec(`DELETE FROM social_work_posts WHERE agent_id IN(901,902,903)`)
		db.Exec(`DELETE FROM social_follows WHERE follower_id=901`)
		db.Exec(`DELETE FROM user_relations WHERE from_uid=901 OR to_uid=901`)
		db.Exec(`DELETE FROM agent_owners WHERE agent_id=901`)
		db.Exec(`DELETE FROM twin_users WHERE user_id='ranking-owner'`)
		db.Exec(`DELETE FROM human_accounts WHERE uid='ranking-owner'`)
		db.Exec(`DELETE FROM agents WHERE agent_id BETWEEN 901 AND 2105`)
	})
	for i, title := range []string{"意图验收：周末旅行", "意图验收：论文复现步骤", "意图验收：论文复现自己的帖子", "意图验收：论文复现私密记录", "意图验收：chair design", "意图验收：AI design", "意图验收：实验工作记录"} {
		d := socialTestDocument()
		d.Title, d.Tags = title, []string{"工作记录"}
		if i == 6 {
			d.Body = "本次实验记录了论文复现的具体步骤、环境要求和结果。"
		}
		author, visibility := 903, "public"
		if i == 0 {
			author = 902
		}
		if i == 2 {
			author = 901
		}
		if i == 3 {
			visibility = "private"
		}
		raw, _ := json.Marshal(d)
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,'published',1,?,?::jsonb,1,?,1)`, 910000+i, author, visibility, string(raw), 100-i).Error)
	}
	// Unrelated popular content used to outrank explicit interests after 1000 likes.
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name) SELECT n,'reader' FROM generate_series(1000,2105) n;
		INSERT INTO social_work_reactions SELECT 910000,n,'like' FROM generate_series(1000,2105) n`).Error)
	h := server.New()
	s := &Service{db: db}
	h.GET("/posts", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(901)); c.Next(ctx) }, s.listSocialPosts)
	call := func(query string) []any {
		t.Helper()
		r := ut.PerformRequest(h.Engine, "GET", "/posts?scope=recommended&q=意图验收"+query, nil)
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
		var e struct {
			Data struct {
				Items []any `json:"items"`
			} `json:"data"`
		}
		check(json.Unmarshal(r.Body.Bytes(), &e))
		return e.Data.Items
	}
	first := func(items []any, want string) {
		t.Helper()
		if len(items) == 0 || items[0].(map[string]any)["id"] != want {
			t.Fatal("unexpected ranking", items, "want", want)
		}
	}
	items := call("")
	first(items, "910001")
	if len(items) != 5 {
		t.Fatal("self/private post leaked", items)
	}
	if items[1].(map[string]any)["id"] != "910006" {
		t.Fatal("body relevance lost to unrelated popular content", items)
	}
	// The current portrait takes precedence over the legacy goal, including clearing it.
	check(db.Exec(`UPDATE twin_users SET portrait_revision=1,portrait_fields='{"recent":"AI","interests":""}' WHERE user_id='ranking-owner'`).Error)
	first(call(""), "910005")
	check(db.Exec(`UPDATE twin_users SET portrait_fields='{"recent":"","interests":"AI"}' WHERE user_id='ranking-owner'`).Error)
	first(call(""), "910005")
	check(db.Exec(`UPDATE twin_users SET portrait_fields='{"recent":"","interests":""}' WHERE user_id='ranking-owner'`).Error)
	first(call("&interests=%5B%22AI%22%2C%22ai%22%2C%22%20%22%5D"), "910005")
	// Neither the matching reader identity nor the followed author is content intent.
	first(call("&interests=%5B%22travel%22%5D"), "910000")
	check(db.Exec(`INSERT INTO user_relations VALUES(903,901,2)`).Error)
	for _, item := range call("&interests=%5B%22AI%22%5D") {
		if fmt.Sprint(item.(map[string]any)["agent_id"]) == "903" {
			t.Fatal("blocked author leaked")
		}
	}
}
