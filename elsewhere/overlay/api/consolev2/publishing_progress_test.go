package consolev2

import (
	"os"
	"testing"
	"time"
)

func TestTwinPublishingProgress(t *testing.T) {
	dsn := os.Getenv("AGENTNET_SOCIAL_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db}
	const id int64 = 778301
	if err := db.Exec(`INSERT INTO agents(agent_id,agent_name) VALUES(?, 'progress fixture'),(?, 'other fixture')`, id, id+1).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM twin_daily_usage WHERE agent_id IN (?,?)`, id, id+1)
		db.Exec(`DELETE FROM agents WHERE agent_id IN (?,?)`, id, id+1)
	})
	if err := db.Exec(`INSERT INTO twin_agent_policy(agent_id,updated_at) VALUES(?,1); INSERT INTO twin_agent_policy(agent_id,daily_feedback,updated_at) VALUES(?,2,1)`, id, id+1).Error; err != nil {
		t.Fatal(err)
	}
	var defaultLimit, savedLimit int
	db.Raw(`SELECT daily_feedback FROM twin_agent_policy WHERE agent_id=?`, id).Scan(&defaultLimit)
	db.Raw(`SELECT daily_feedback FROM twin_agent_policy WHERE agent_id=?`, id+1).Scan(&savedLimit)
	if defaultLimit != 40 || savedLimit != 2 {
		t.Fatalf("new default or explicit limit lost: default=%d saved=%d", defaultLimit, savedLimit)
	}
	// 16:00 UTC is exactly the next day's midnight in the product timezone.
	now := time.Date(2026, 10, 16, 16, 0, 0, 0, time.UTC)
	read := func(limit int, at time.Time) publishingProgress {
		t.Helper()
		p, err := s.dailyPublishingProgress(id, limit, at)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	p := read(10, now)
	if p.Day != "2026-10-17" || p.Minimum != 5 || p.RemainingToMinimum != 5 || p.QuotaRemaining != 10 {
		t.Fatalf("empty day: %+v", p)
	}
	insert := func(post, owner int64, state, visibility string, at time.Time) {
		t.Helper()
		if err := db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,visibility,document,created_at,published_at,approved_revision) VALUES(?,?,?,?,'{}',?,?,1)`, post, owner, state, visibility, at.UnixMilli(), at.UnixMilli()).Error; err != nil {
			t.Fatal(err)
		}
	}
	insert(id+10, id, "published", "public", now.Add(-time.Millisecond))
	insert(id+11, id, "published", "public", now)
	insert(id+12, id, "draft", "public", now)
	insert(id+13, id, "published", "private", now)
	insert(id+14, id, "published", "friends", now)
	insert(id+15, id+1, "published", "public", now)
	insert(id+16, id, "published", "public", now.Add(24*time.Hour))
	if err := db.Exec(`INSERT INTO twin_daily_usage(agent_id,day,activity,used) VALUES(?,'2026-10-17','posts',4),(?,'2026-10-17','feedback',9)`, id, id).Error; err != nil {
		t.Fatal(err)
	}
	p = read(10, now)
	if p.Published != 1 || p.RemainingToMinimum != 4 || p.QuotaUsed != 4 || p.QuotaRemaining != 6 {
		t.Fatalf("counted drafts, other owners, private posts, wrong dates or attempts: %+v", p)
	}
	insert(id+17, id, "published", "public", now)
	insert(id+18, id, "published", "public", now)
	p = read(10, now)
	if p.Published != 3 || p.RemainingToMinimum != 2 {
		t.Fatalf("old three-post target incorrectly treated as complete: %+v", p)
	}
	insert(id+19, id, "published", "public", now)
	p = read(10, now)
	if p.Published != 4 || p.RemainingToMinimum != 1 {
		t.Fatalf("four posts must leave one outstanding: %+v", p)
	}
	insert(id+20, id, "published", "public", now)
	p = read(10, now)
	if p.Published != 5 || p.RemainingToMinimum != 0 {
		t.Fatalf("minimum not completed: %+v", p)
	}
	insert(id+21, id, "published", "public", now)
	p = read(10, now)
	if p.Published != 6 || p.RemainingToMinimum != 0 {
		t.Fatalf("completed progress went negative: %+v", p)
	}
	p = read(0, now)
	if !p.LimitBelowMinimum || p.QuotaRemaining != 0 || p.Minimum != 5 {
		t.Fatalf("quota conflict hidden or overridden: %+v", p)
	}
	p = read(3, now)
	if !p.LimitBelowMinimum || p.Minimum != 5 || p.QuotaRemaining != 0 {
		t.Fatalf("saved three-post cap must not silently satisfy or bypass the minimum: %+v", p)
	}
	p = read(10, now.Add(-time.Millisecond))
	if p.Day != "2026-10-16" || p.Published != 1 || p.QuotaUsed != 0 {
		t.Fatalf("midnight rollover: %+v", p)
	}
}
