package consolev2

import (
	"context"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/gorm"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagedPublicCatalog(t *testing.T) {
	profiles := celebrityCatalog()
	if len(profiles) < 100 {
		t.Fatal(len(profiles))
	}
	seen := map[string]bool{}
	tech := 0
	for _, p := range profiles {
		if seen[p.Key] || p.Voice == "" || p.Focus == "" || !strings.HasPrefix(p.Reference, "https://") {
			t.Fatal(p.Key)
		}
		seen[p.Key] = true
		if p.Sector == "科技" {
			tech++
		}
		entry := celebrityPersona(p)
		if !strings.Contains(entry.recruitmentDraft.IdentityCard.AgentDescription, "非本人") {
			t.Fatal("missing disclosure")
		}
		for _, step := range []int16{2, 3, 5} {
			if e := validateDraftStep(*entry.recruitmentDraft, step); e != nil {
				t.Fatal(p.Key, e)
			}
		}
	}
	if tech < 60 {
		t.Fatal(tech)
	}
	index := 20000
	job := managedJob{SeedIndex: &index}
	if celebrityOutputAllowed(job, managedOutput{Content: "我的主人派我来"}) {
		t.Fatal("false delegation accepted")
	}
	if !celebrityOutputAllowed(job, managedOutput{Content: "从他的公开观点来看，成本值得进一步分析。"}) {
		t.Fatal("normal proxy voice rejected")
	}
}
func TestManagedRecruitmentParse(t *testing.T) {
	good := `{"jobs":[{"id":1,"title":"Engineer","absolute_url":"https://job-boards.greenhouse.io/anthropic/jobs/1","location":{"name":"Remote"},"content":"<p>Build systems</p>"}],"meta":{"total":1}}`
	jobs, e := parseRecruitmentJobs([]byte(good), "greenhouse")
	if e != nil || len(jobs) != 1 || jobs[0].Description != "Build systems" {
		t.Fatal(jobs, e)
	}
	for _, bad := range []string{`{}`, `{"error":"rate limit"}`, strings.Replace(good, `"total":1`, `"total":2`, 1), strings.Replace(good, "https://job-boards.greenhouse.io/anthropic/jobs/1", "http://127.0.0.1/private", 1)} {
		if _, e := parseRecruitmentJobs([]byte(bad), "greenhouse"); e == nil {
			t.Fatal("invalid snapshot accepted")
		}
	}
	ashby := `{"jobs":[{"id":"a","title":"Engineer","jobUrl":"https://jobs.ashbyhq.com/openai/a","location":"Remote","descriptionPlain":"Build","isListed":true},{"id":"b","title":"Hidden","isListed":false}]}`
	if jobs, e = parseRecruitmentJobs([]byte(ashby), "ashby"); e != nil || len(jobs) != 1 {
		t.Fatal(jobs, e)
	}
	if _, e = publicSourceFetch(context.Background(), "https://127.0.0.1/secrets"); e == nil {
		t.Fatal("unsafe source")
	}
}
func TestManagedPublicSnapshot(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn)
	// Always roll back to preserve other suites' identity/count assumptions.
	rollback := db.Transaction(func(tx *gorm.DB) error {
		check := func(e error) {
			if e != nil {
				t.Fatal(e)
			}
		}
		now := time.Now()
		check(tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('public-source-test',19991,'!test','!test',?)`, now.UnixMilli()).Error)
		s := &Service{db: tx, idgen: &managedTestIDs{id: 35000000}}
		entries := map[int]managedPersona{}
		for i, p := range celebrityCatalog() {
			entries[20000+i] = celebrityPersona(p)
		}
		ids, e := s.provisionManagedEntries(context.Background(), "public-source-test", entries)
		check(e)
		if len(ids) != 105 {
			t.Fatal(len(ids))
		}
		again, e := s.provisionManagedEntries(context.Background(), "public-source-test", entries)
		check(e)
		if len(again) != 0 {
			t.Fatal("duplicate identities")
		}
		check(tx.Exec(`INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id) VALUES('public-source-test','anthropic','recruitment',?)`, ids[0]).Error)
		originals := []managedSource{{Title: "Original expression", URL: "https://blog.samaltman.com/example", Published: now.UTC().Format(time.RFC3339), Kind: "self_post"}}
		check(savePublicOriginals(tx, "public-source-test", "anthropic", "[]", originals, "ready", now))
		var originalChecked int64
		check(tx.Raw(`SELECT original_checked_at FROM managed_public_sources WHERE sponsor_uid='public-source-test' AND source_key='anthropic'`).Scan(&originalChecked).Error)
		if originalChecked != now.UnixMilli() {
			t.Fatal("original success timestamp not persisted", originalChecked)
		}
		check(savePublicOriginals(tx, "public-source-test", "anthropic", "[]", nil, "unavailable", now.Add(time.Minute)))
		check(tx.Raw(`SELECT original_checked_at FROM managed_public_sources WHERE sponsor_uid='public-source-test' AND source_key='anthropic'`).Scan(&originalChecked).Error)
		if originalChecked != now.UnixMilli() {
			t.Fatal("failed fetch erased success timestamp", originalChecked)
		}
		board := recruitmentBoards[0]
		jobs := []publicJob{{"1", "Engineer", "Remote", "https://job-boards.greenhouse.io/anthropic/jobs/1", "Build"}, {"2", "Designer", "Remote", "https://job-boards.greenhouse.io/anthropic/jobs/2", "Design"}}
		check(s.applyRecruitmentSnapshot(tx, "public-source-test", board, ids[0], jobs, now))
		var posts []struct{ PostID, Revision int64 }
		read := func() {
			check(tx.Raw(`SELECT post_id,revision FROM social_work_posts WHERE agent_id=? ORDER BY post_id`, ids[0]).Scan(&posts).Error)
		}
		read()
		if len(posts) != 2 {
			t.Fatal(posts)
		}
		first := posts[0].PostID
		check(s.applyRecruitmentSnapshot(tx, "public-source-test", board, ids[0], jobs, now.Add(time.Minute)))
		read()
		if len(posts) != 2 || posts[0].Revision != 1 {
			t.Fatal("duplicate or unchanged rewrite", posts)
		}
		check(s.applyRecruitmentSnapshotMode(tx, "public-source-test", board, ids[0], jobs[:1], now.Add(time.Minute), false))
		var remaining string
		check(tx.Raw(`SELECT state FROM managed_recruitment_jobs WHERE sponsor_uid='public-source-test' AND source_key='anthropic' AND external_id='2'`).Scan(&remaining).Error)
		if remaining != "open" {
			t.Fatal("partial snapshot closed unseen job")
		}
		jobs[0].Location = "London"
		check(s.applyRecruitmentSnapshot(tx, "public-source-test", board, ids[0], jobs[:1], now.Add(2*time.Minute)))
		read()
		if posts[0].PostID != first || posts[0].Revision != 2 {
			t.Fatal("post identity changed", posts)
		}
		var doc string
		check(tx.Raw(`SELECT document::text FROM social_work_posts WHERE post_id=?`, posts[1].PostID).Scan(&doc).Error)
		if !strings.Contains(doc, "已关闭") {
			t.Fatal(doc)
		}
		check(s.applyRecruitmentSnapshot(tx, "public-source-test", board, ids[0], jobs, now.Add(3*time.Minute)))
		read()
		if len(posts) != 2 {
			t.Fatal("reopen duplicated")
		}
		var value map[string]any
		check(tx.Raw(`SELECT document::text FROM social_work_posts WHERE post_id=?`, posts[1].PostID).Scan(&doc).Error)
		check(json.Unmarshal([]byte(doc), &value))
		if strings.Contains(value["title"].(string), "已关闭") {
			t.Fatal("reopen failed")
		}
		originalTransport := http.DefaultTransport
		defer func() { http.DefaultTransport = originalTransport }()
		http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("unavailable"))}, nil
		})
		if e := s.syncPublicSourceKey(context.Background(), "public-source-test", "anthropic", true); e == nil {
			t.Fatal("failed fetch reported success")
		}
		read()
		if len(posts) != 2 {
			t.Fatal("failed fetch removed posts")
		}
		var status string
		check(tx.Raw("SELECT status FROM managed_public_sources WHERE sponsor_uid='public-source-test' AND source_key='anthropic'").Scan(&status).Error)
		if status != "unavailable" {
			t.Fatal(status)
		}
		return errConflict
	})
	if rollback != errConflict {
		t.Fatal(rollback)
	}
}

func TestManagedPublicRequiresOperator(t *testing.T) {
	s := &Service{}
	h := server.New()
	h.GET("/public", s.getPublicAgents)
	h.POST("/seed", s.seedPublicAgents)
	h.PUT("/source/:key", s.updatePublicSource)
	h.POST("/source/:key/sync", s.syncPublicSource)
	for _, r := range []struct{ method, path string }{{"GET", "/public"}, {"POST", "/seed"}, {"PUT", "/source/anthropic"}, {"POST", "/source/anthropic/sync"}} {
		if response := ut.PerformRequest(h.Engine, r.method, r.path, nil); response.Code != 403 {
			t.Fatal(r, response.Code)
		}
	}
}
func TestManagedPublicOriginalGrounding(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	raw := []byte(`<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"timeline":{"entries":[{"type":"tweet","content":{"tweet":{"id_str":"1","full_text":"First person original","created_at":"Fri Oct 16 01:57:58 +0000 2026","user":{"screen_name":"sample"}}}},{"type":"tweet","content":{"tweet":{"id_str":"2","full_text":"Other author","created_at":"Fri Oct 16 01:57:58 +0000 2026","user":{"screen_name":"someoneelse"}}}},{"type":"tweet","content":{"tweet":{"id_str":"3","full_text":"RT @other: copied","created_at":"Fri Oct 16 01:57:58 +0000 2026","user":{"screen_name":"sample"}}}}]}}}}</script>`)
	items, e := parsePublicTimeline(raw, "sample", now)
	if e != nil || len(items) != 1 || items[0].Kind != "self_post" || items[0].URL != "https://x.com/sample/status/1" {
		t.Fatal(items, e)
	}
	if _, e = parsePublicTimeline([]byte(`<html>Login required</html>`), "sample", now); e == nil {
		t.Fatal("login wall became successful empty feed")
	}
	atom := []byte(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Original essay</title><link href="https://blog.samaltman.com/essay"/><published>2022-01-01T00:00:00Z</published><content>Historical expression</content></entry><entry><title>Offsite</title><link href="https://attacker.example/"/><published>2026-10-15T00:00:00Z</published></entry></feed>`)
	samples, e := parsePublicOriginalFeed(atom, "https://blog.samaltman.com/posts.atom", "Sam", now)
	if e != nil || len(samples) != 1 || samples[0].Published != "2022-01-01T00:00:00Z" {
		t.Fatal(samples, e)
	}
	old, _ := json.Marshal(items)
	items[0].Summary = "Updated text"
	merged := mergePublicOriginals(string(old), items)
	if len(merged) != 1 || merged[0].Summary != "Updated text" {
		t.Fatal("duplicates or stale expression", merged)
	}
}
func TestManagedChinaPagination(t *testing.T) {
	var board recruitmentBoard
	mainland := 0
	for _, b := range recruitmentBoards {
		if b.Provider != "ashby" && b.Provider != "greenhouse" {
			mainland++
		}
		if b.Key == "tencent" {
			board = b
		}
	}
	if mainland <= len(recruitmentBoards)/2 {
		t.Fatal("mainland must be primary")
	}
	transport := http.DefaultTransport
	defer func() { http.DefaultTransport = transport }()
	calls := 0
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		raw := `{"Code":200,"Data":{"Count":2,"Posts":[{"PostId":"1","RecruitPostName":"工程师","LocationName":"深圳"}]}}`
		if r.URL.Query().Get("pageIndex") == "2" {
			raw = `{"Code":200,"Data":{"Count":2,"Posts":[{"PostId":"2","RecruitPostName":"设计师","LocationName":"北京"}]}}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(raw))}, nil
	})
	jobs, e := fetchRecruitmentJobs(context.Background(), board)
	if e != nil || len(jobs) != 2 || calls != 2 {
		t.Fatal(jobs, calls, e)
	}
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"Code":200,"Data":{"Count":2,"Posts":[]}}`))}, nil
	})
	if _, e = fetchRecruitmentJobs(context.Background(), board); e == nil {
		t.Fatal("partial snapshot accepted")
	}
}
func TestManagedPublicLiveSources(t *testing.T) {
	if os.Getenv("AGENTNET_PUBLIC_SOURCE_LIVE") != "true" {
		t.Skip("explicit read-only live probe")
	}
	for _, b := range recruitmentBoards {
		if key := os.Getenv("AGENTNET_PUBLIC_SOURCE_LIVE_KEY"); key != "" && b.Key != key {
			continue
		}
		if b.Provider == "ashby" || b.Provider == "greenhouse" {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
		jobs, e := fetchRecruitmentJobs(ctx, b)
		cancel()
		t.Logf("official board %s jobs=%d available=%v error=%v", b.Key, len(jobs), e == nil, e)
		if e == nil && len(jobs) > 0 && jobs[0].Title == "" {
			t.Fatal("missing title")
		}
	}
	p := celebrityCatalog()[0]
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	items, status := fetchPublicOriginals(ctx, p, time.Now())
	t.Logf("original timeline %s samples=%d status=%s", p.Key, len(items), status)
	if len(items) == 0 {
		t.Fatal("no original timeline evidence")
	}
}
func TestManagedPublicSiteCooldown(t *testing.T) {
	transport := http.DefaultTransport
	defer func() {
		http.DefaultTransport = transport
		publicFetchGate.Lock()
		delete(publicFetchGate.blocked, "news.google.com")
		publicFetchGate.Unlock()
	}()
	calls := 0
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": []string{"600"}}, Body: io.NopCloser(strings.NewReader("limited"))}, nil
	})
	for _, endpoint := range []string{"https://news.google.com/rss/search?q=one", "https://news.google.com/rss/search?q=two"} {
		if _, e := publicSourceFetch(context.Background(), endpoint); e == nil {
			t.Fatal("rate limit accepted")
		}
	}
	if calls != 1 {
		t.Fatal("host cooldown failed", calls)
	}
}
