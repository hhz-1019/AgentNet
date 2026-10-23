package consolev2

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestSocialGorseOrderAndAccess(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name) SELECT n,'推荐候选' FROM generate_series(9701,9708) n; INSERT INTO user_relations VALUES(9701,9708,2)`).Error)
	t.Cleanup(func() {
		db.Exec(`DELETE FROM social_work_posts WHERE agent_id BETWEEN 9701 AND 9708`)
		db.Exec(`DELETE FROM user_relations WHERE from_uid=9701`)
		db.Exec(`DELETE FROM agents WHERE agent_id BETWEEN 9701 AND 9708`)
	})
	for i, author := range []int{9702, 9703, 9701, 9704, 9705, 9708} {
		d := socialTestDocument()
		d.Title = fmt.Sprintf("推荐候选%d", i)
		b, _ := json.Marshal(d)
		visibility := "public"
		if i == 3 {
			visibility = "private"
		}
		if i == 4 {
			visibility = "friends"
		}
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,'published',1,?,?::jsonb,1,1,1)`, 970000+i, author, visibility, string(b)).Error)
	}
	removed := false
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "fixture-key" {
			t.Error("missing engine auth")
		}
		switch {
		case r.Method == "GET" && r.URL.Path == "/api/user/agent:9701":
			w.WriteHeader(404)
			fmt.Fprint(w, `{}`)
		case r.Method == "POST" && r.URL.Path == "/api/user":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["UserId"] != "agent:9701" || body["Comment"] != "" {
				t.Error("unexpected user metadata", body)
			}
			fmt.Fprint(w, `{}`)
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/feedback"):
			fmt.Fprint(w, `[{"FeedbackType":"like","UserId":"agent:9701","ItemId":"post:970005"}]`)
		case r.Method == "DELETE":
			removed = true
			fmt.Fprint(w, `{}`)
		case strings.HasPrefix(r.URL.Path, "/api/recommend/"):
			fmt.Fprint(w, `["post:970001","post:970005","post:970003","post:970004","post:970002","post:970000","post:970001","unexpected","post:999999"]`)
		default:
			t.Error("unexpected request", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer engine.Close()
	t.Setenv("AGENTNET_GORSE_URL", engine.URL)
	t.Setenv("AGENTNET_GORSE_API_KEY", "fixture-key")
	h := server.New()
	s := &Service{db: db}
	h.GET("/posts", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", int64(9701)); c.Next(ctx) }, s.listSocialPosts)
	call := func(query string) (int, map[string]any) {
		r := ut.PerformRequest(h.Engine, "GET", "/posts?scope=opportunities"+query, nil)
		var e struct {
			Data map[string]any `json:"data"`
		}
		check(json.Unmarshal(r.Body.Bytes(), &e))
		return r.Code, e.Data
	}
	code, data := call("")
	if code != 200 {
		t.Fatal(code, data)
	}
	items := data["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["id"] != "970001" || items[1].(map[string]any)["id"] != "970000" {
		t.Fatal("changed Gorse order or leaked access", data)
	}
	if !removed || data["ranking_version"] != socialGorseVersion || data["intent_handling"] != "network_profile_and_host" {
		t.Fatal(data)
	}
	code, data = call("&exclude_ids=" + url.QueryEscape(`["970001"]`))
	if code != 200 || len(data["items"].([]any)) != 1 {
		t.Fatal(code, data)
	}
	for _, query := range []string{"&cursor=123", "&intent=private-memory", "&exclude_ids=%5B42%5D", "&tags=bad"} {
		code, _ = call(query)
		if code != 400 {
			t.Fatal("invalid input accepted", query)
		}
	}
	t.Setenv("AGENTNET_GORSE_URL", "")
	code, _ = call("")
	if code != 503 {
		t.Fatal("silently substituted own ranking")
	}
}

func TestSocialGorseRealEngine(t *testing.T) {
	path := os.Getenv("AGENTNET_RECOMMENDATION_CORPUS")
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	engine := os.Getenv("AGENTNET_TEST_GORSE_URL")
	if path == "" || dsn == "" || engine == "" {
		t.Skip("optional real Gorse/captured public corpus replay")
	}
	t.Setenv("AGENTNET_GORSE_URL", engine)
	t.Setenv("AGENTNET_GORSE_API_KEY", os.Getenv("AGENTNET_TEST_GORSE_KEY"))
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var posts []struct {
		ID, AgentID, Author string
		Document            json.RawMessage
		PublishedAt         int64
		Liked, Saved        bool
	}
	// Production uses snake_case, preserve exact string IDs.
	var raw []map[string]json.RawMessage
	if err = json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, r := range raw {
		p := struct {
			ID, AgentID, Author string
			Document            json.RawMessage
			PublishedAt         int64
			Liked, Saved        bool
		}{}
		json.Unmarshal(r["id"], &p.ID)
		json.Unmarshal(r["agent_id"], &p.AgentID)
		json.Unmarshal(r["author_name"], &p.Author)
		json.Unmarshal(r["published_at"], &p.PublishedAt)
		json.Unmarshal(r["liked"], &p.Liked)
		json.Unmarshal(r["saved"], &p.Saved)
		p.Document = r["document"]
		posts = append(posts, p)
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	const viewer = int64(368750834374152192)
	authors := map[string]bool{fmt.Sprint(viewer): true}
	ids := []string{}
	check(db.Exec(`INSERT INTO agents(agent_id,agent_name) VALUES(?,'知遥') ON CONFLICT DO NOTHING`, viewer).Error)
	for _, p := range posts {
		authors[p.AgentID] = true
		check(db.Exec(`INSERT INTO agents(agent_id,agent_name) VALUES(?,?) ON CONFLICT DO NOTHING`, p.AgentID, p.Author).Error)
		check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,'published',1,'public',?::jsonb,?,?,1)`, p.ID, p.AgentID, string(p.Document), p.PublishedAt, p.PublishedAt).Error)
		ids = append(ids, p.ID)
		for kind, yes := range map[string]bool{"like": p.Liked, "save": p.Saved} {
			if yes {
				check(db.Exec(`INSERT INTO social_work_reactions VALUES(?,?,?)`, p.ID, viewer, kind).Error)
			}
		}
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM social_work_posts WHERE post_id IN ?`, ids)
		for id := range authors {
			db.Exec(`DELETE FROM agents WHERE agent_id=?`, id)
		}
	})
	h := server.New()
	s := &Service{db: db}
	h.GET("/posts", func(ctx context.Context, c *app.RequestContext) { c.Set("agent_id", viewer); c.Next(ctx) }, s.listSocialPosts)
	r := ut.PerformRequest(h.Engine, "GET", "/posts?scope=opportunities", nil)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	var result struct {
		Data struct {
			Items   []map[string]any `json:"items"`
			Version string           `json:"ranking_version"`
		} `json:"data"`
	}
	check(json.Unmarshal(r.Body.Bytes(), &result))
	if result.Data.Version != socialGorseVersion || len(result.Data.Items) == 0 {
		t.Fatal(r.Body.String())
	}
	for _, p := range result.Data.Items {
		if p["agent_id"] == fmt.Sprint(viewer) {
			t.Fatal("self recommended")
		}
	}
	// Regression for the production incident: a busy SQLite cache must not
	// turn unchanged recommendation reads into blocking cache writes.
	if cachePath := os.Getenv("AGENTNET_TEST_GORSE_CACHE"); cachePath != "" {
		lock := exec.Command("sqlite3", cachePath)
		input, e := lock.StdinPipe()
		check(e)
		output, e := lock.StdoutPipe()
		check(e)
		check(lock.Start())
		defer func() { input.Close(); lock.Wait() }()
		_, e = fmt.Fprintln(input, ".timeout 10000\nBEGIN IMMEDIATE;\nSELECT 'locked';")
		check(e)
		scanner := bufio.NewScanner(output)
		if !scanner.Scan() || scanner.Text() != "locked" {
			t.Fatal("cache lock was not acquired")
		}
		g := socialGorseClient{engine, os.Getenv("AGENTNET_TEST_GORSE_KEY")}
		started := time.Now()
		err := g.request(context.Background(), "POST", "/api/user", map[string]any{"UserId": fmt.Sprint("agent:", viewer), "Labels": []string{}}, nil)
		if err == nil {
			t.Fatal("baseline write unexpectedly succeeded while cache locked")
		}
		t.Logf("baseline repeated user write failed under cache contention after %s", time.Since(started))
		for i := 0; i < 10; i++ {
			started = time.Now()
			response := ut.PerformRequest(h.Engine, "GET", "/posts?scope=opportunities", nil)
			if response.Code != 200 {
				t.Fatalf("read while cache locked: %d %s", response.Code, response.Body.String())
			}
			if time.Since(started) > 2*time.Second {
				t.Fatal("unchanged recommendation read blocked on cache writer")
			}
			t.Logf("fixed adapter recommendation under cache contention: %s", time.Since(started))
		}
		_, e = fmt.Fprintln(input, "COMMIT;")
		check(e)
	}
	if report := os.Getenv("AGENTNET_RECOMMENDATION_REPORT"); report != "" {
		check(os.WriteFile(report, r.Body.Bytes(), 0600))
	}
}

func TestSocialGorseRequestFailures(t *testing.T) {
	for _, status := range []int{404, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				fmt.Fprint(w, "private upstream details")
			}))
			defer engine.Close()
			g := socialGorseClient{engine.URL, "secret"}
			err := g.request(context.Background(), "GET", "/api/user/agent:123/feedback", nil, nil)
			var detail *socialGorseError
			if !errors.As(err, &detail) || detail.Status != status || detail.Stage != "feedback_get" {
				t.Fatal(err)
			}
			if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "123") || strings.Contains(err.Error(), engine.URL) {
				t.Fatal("unsafe error", err)
			}
		})
	}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(100 * time.Millisecond):
		}
	}))
	defer engine.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err := (socialGorseClient{engine.URL, "secret"}).request(ctx, "POST", "/api/feedback", []string{}, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("lost timeout cause", err)
	}
}

func TestSocialGorseViewerIncrementalSync(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("run test:social:core")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec("INSERT INTO agents(agent_id,agent_name) VALUES(9801,'viewer'),(9802,'author')").Error)
	d, _ := json.Marshal(socialTestDocument())
	check(db.Exec("INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at,approved_revision) VALUES(980001,9802,'published',1,'public',?::jsonb,1,1,1)", string(d)).Error)
	t.Cleanup(func() {
		db.Exec("DELETE FROM social_work_reactions WHERE agent_id=9801")
		db.Exec("DELETE FROM social_work_posts WHERE post_id=980001")
		db.Exec("DELETE FROM social_preferences WHERE agent_id=9801")
		db.Exec("DELETE FROM agent_companions WHERE agent_id=9801")
		db.Exec("DELETE FROM agents WHERE agent_id IN(9801,9802)")
	})
	present, userWrites, feedbackWrites, deletes := false, 0, 0, 0
	labels := []string{}
	comment := ""
	feedback := []socialGorseFeedback{}
	unavailable := false
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unavailable {
			w.WriteHeader(503)
			return
		}
		switch {
		case r.Method == "GET" && r.URL.Path == "/api/user/agent:9801":
			if !present {
				w.WriteHeader(404)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"Labels": labels, "Comment": comment})
		case r.Method == "POST" && r.URL.Path == "/api/user":
			var u struct {
				Labels  []string
				Comment string
			}
			json.NewDecoder(r.Body).Decode(&u)
			labels = u.Labels
			comment = u.Comment
			present = true
			userWrites++
			fmt.Fprint(w, "{}")
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/feedback"):
			json.NewEncoder(w).Encode(feedback)
		case r.Method == "POST" && r.URL.Path == "/api/feedback":
			var incoming []socialGorseFeedback
			json.NewDecoder(r.Body).Decode(&incoming)
			feedback = append(feedback, incoming...)
			feedbackWrites += len(incoming)
			fmt.Fprint(w, "{}")
		case r.Method == "DELETE":
			deletes++
			feedback = nil
			fmt.Fprint(w, "{}")
		default:
			t.Error(r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer engine.Close()
	s := &Service{db: db}
	g := socialGorseClient{engine.URL, "test"}
	run := func(want int) {
		t.Helper()
		count, err := s.syncSocialGorseViewer(context.Background(), g, 9801)
		check(err)
		if count != want {
			t.Fatal(count, want)
		}
	}
	run(0)
	run(0)
	if userWrites != 1 || feedbackWrites != 0 {
		t.Fatal("unchanged user was rewritten", userWrites, feedbackWrites)
	}
	check(db.Exec("INSERT INTO social_work_reactions VALUES(980001,9801,'like')").Error)
	run(1)
	run(1)
	if feedbackWrites != 1 || userWrites != 1 {
		t.Fatal("unchanged feedback rewritten", feedbackWrites, userWrites)
	}
	labels = []string{"outdated"}
	run(1)
	if userWrites != 2 || feedbackWrites != 1 {
		t.Fatal("changed profile not synchronized")
	}
	check(db.Exec("DELETE FROM social_work_reactions WHERE agent_id=9801").Error)
	run(0)
	run(0)
	if deletes != 1 {
		t.Fatal("removed reaction not reconciled", deletes)
	}
	check(db.Exec("INSERT INTO agent_companions(agent_id,connection_goal,updated_at) VALUES(9801,'英语口语伙伴',1)").Error)
	run(0)
	run(0)
	if userWrites != 3 || !strings.Contains(comment, "英语口语伙伴") {
		t.Fatal("full network card update did not sync once", userWrites, comment)
	}
	check(db.Exec("UPDATE agent_companions SET connection_goal='' WHERE agent_id=9801").Error)
	run(0)
	run(0)
	if userWrites != 4 || comment != "" {
		t.Fatal("cleared network card retained", userWrites, comment)
	}
	unavailable = true
	_, err := s.syncSocialGorseViewer(context.Background(), g, 9801)
	var detail *socialGorseError
	if !errors.As(err, &detail) || detail.Status != 503 || userWrites != 4 {
		t.Fatal("upstream outage treated as missing user", err, userWrites)
	}
}
