package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestManagedCelebrityRosterIdentity(t *testing.T) {
	profiles := celebrityCatalog()
	active, retired := 0, 0
	keys := map[string]int{}
	for i, p := range profiles {
		keys[p.Key]++
		if (p.Key == "wang-xing" || p.Key == "wang-xiaochuan") && p.Retired {
			t.Fatal("requested retained member retired", p.Key)
		}
		if p.Retired {
			retired++
		} else {
			active++
		}
		index := 20000 + i
		if celebrityForJob(managedJob{SeedIndex: &index}).Key != p.Key {
			t.Fatal("identity remapped", p.Key)
		}
	}
	if active != 92 || retired != 27 {
		t.Fatal(active, retired)
	}
	for _, key := range []string{"elon-musk", "lei-jun", "jensen-huang", "thibault-sottiaux", "tobi-l-tke", "wang-xiaochuan", "wang-xing", "eason-chan", "jj-lin", "zhou-shen", "jackson-yee", "liu-yifei", "jia-ling"} {
		if keys[key] != 1 {
			t.Fatal("missing or duplicated", key)
		}
	}
	if profiles[105].Key != "thibault-sottiaux" {
		t.Fatal("new profiles must append after existing identities")
	}
}

func TestManagedPublicEventsAndRetirement(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	const owner = "event-roster-test"
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,987654211,'!x','!x',1)`, owner).Error)
	s := &Service{db: db, idgen: &managedTestIDs{id: 39800000}}
	p := celebrityCatalog()[0]
	ids, e := s.provisionManagedEntries(context.Background(), owner, map[int]managedPersona{20000: celebrityPersona(p)})
	check(e)
	id := ids[0]
	now := time.Now().UTC().Truncate(time.Second)
	later := now.Add(3 * time.Hour).UnixMilli()
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true WHERE sponsor_uid=?`, owner).Error)
	check(db.Exec(`UPDATE managed_members SET enabled=true,next_run_at=? WHERE agent_id=?`, later, id).Error)
	check(db.Exec(`INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id,enabled,checked_at,background_checked_at) VALUES(?,?,'celebrity',?,true,?,?)`, owner, p.Key, id, now.Add(-time.Hour).UnixMilli(), now.UnixMilli()).Error)
	item := managedSource{Title: "A real event", URL: "https://x.com/elonmusk/status/111", Published: now.Add(-time.Minute).Format(time.RFC3339), Summary: "One change"}
	readNext := func() int64 {
		var n int64
		check(db.Raw("SELECT next_run_at FROM managed_members WHERE agent_id=?", id).Scan(&n).Error)
		return n
	}
	reset := func() { check(db.Exec("UPDATE managed_members SET next_run_at=? WHERE agent_id=?", later, id).Error) }
	check(recordPublicEvents(db, owner, p.Key, id, []managedSource{item}, true, now))
	if readNext() != later {
		t.Fatal("baseline woke agent")
	}
	check(recordPublicEvents(db, owner, p.Key, id, []managedSource{item}, false, now))
	if readNext() != later {
		t.Fatal("same observation woke agent")
	}
	item.Summary = "Updated public information"
	check(recordPublicEvents(db, owner, p.Key, id, []managedSource{item}, false, now))
	if readNext() > now.Add(90*time.Second).UnixMilli() {
		t.Fatal("new event did not wake shared activity")
	}
	reset()
	item.URL += "?utm_source=tracking"
	check(recordPublicEvents(db, owner, p.Key, id, []managedSource{item}, false, now))
	if readNext() != later {
		t.Fatal("tracking link caused duplicate wake")
	}
	for _, age := range []time.Duration{-72 * time.Hour, time.Hour} {
		item.Published = now.Add(age).Format(time.RFC3339)
		item.Summary = item.Published
		check(recordPublicEvents(db, owner, p.Key, id, []managedSource{item}, false, now))
		if readNext() != later {
			t.Fatal("old/future material woke agent")
		}
	}
	item.Published = now.Format(time.RFC3339)
	for _, guard := range []string{"pending_action='message'", "pending_topic='human task'", "enabled=false"} {
		check(db.Exec("UPDATE managed_members SET "+guard+" WHERE agent_id=?", id).Error)
		item.Summary = guard
		check(recordPublicEvents(db, owner, p.Key, id, []managedSource{item}, false, now))
		if readNext() != later {
			t.Fatal("operator state bypassed", guard)
		}
		check(db.Exec("UPDATE managed_members SET enabled=true,pending_action='',pending_topic='' WHERE agent_id=?", id).Error)
	}
	// Exercise the real synchronization boundary, with a network failure followed
	// by a new original. A failed news fetch must not erase/lose original activity.
	check(db.Exec("UPDATE managed_public_sources SET original_checked_at=? WHERE agent_id=?", now.Add(-time.Hour).UnixMilli(), id).Error)
	transport := http.DefaultTransport
	defer func() { http.DefaultTransport = transport }()
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "syndication.twitter.com" {
			payload := map[string]any{"props": map[string]any{"pageProps": map[string]any{"timeline": map[string]any{"entries": []any{map[string]any{"type": "tweet", "content": map[string]any{"tweet": map[string]any{"id_str": "222", "full_text": "New original event", "created_at": now.Add(-time.Minute).Format("Mon Jan 02 15:04:05 -0700 2006"), "user": map[string]any{"screen_name": "elonmusk"}}}}}}}}}
			raw, _ := json.Marshal(payload)
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`<script id="__NEXT_DATA__">` + string(raw) + `</script>`))}, nil
		}
		return &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("unavailable"))}, nil
	})
	if s.syncPublicSourceKey(context.Background(), owner, p.Key, true) == nil {
		t.Fatal("news failure not reported")
	}
	if readNext() > now.Add(2*time.Minute).UnixMilli() {
		t.Fatal("successful original lost on news failure")
	}
	reset()
	_ = s.syncPublicSourceKey(context.Background(), owner, p.Key, true)
	if readNext() != later {
		t.Fatal("same original woke agent twice")
	}
	// Retirement only touches the managed source association, never a real user.
	var retired celebrityProfile
	var index int
	for i, p := range celebrityCatalog() {
		if p.Retired {
			retired = p
			index = 20000 + i
			break
		}
	}
	other, e := s.provisionManagedEntries(context.Background(), owner, map[int]managedPersona{index: celebrityPersona(retired)})
	check(e)
	check(db.Exec("UPDATE managed_members SET enabled=true WHERE agent_id=?", other[0]).Error)
	check(db.Exec(`INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id,enabled) VALUES(?,?,'celebrity',?,true)`, owner, retired.Key, other[0]).Error)
	check(retireCelebrityMembers(db, owner))
	check(retireCelebrityMembers(db, owner))
	var state struct {
		Enabled   bool
		DeletedAt int64
		Name      string
	}
	check(db.Raw("SELECT enabled,deleted_at,name FROM managed_members WHERE agent_id=?", other[0]).Scan(&state).Error)
	if state.Enabled || state.DeletedAt != 0 || state.Name != celebrityPersona(retired).Name {
		t.Fatal("retirement changed identity", state)
	}
	var active bool
	check(db.Raw("SELECT enabled FROM managed_members WHERE agent_id=?", id).Scan(&active).Error)
	if !active {
		t.Fatal("unrelated member disabled")
	}
	// Exercise the operator endpoint twice: new identities get complete profiles
	// and avatars, retired slots stay reserved, operator choices survive reruns.
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654211")
	session, e := s.newUIDSession(db, app.NewContext(0), owner, id, now.UnixMilli())
	check(e)
	h := server.New()
	h.POST("/seed", func(ctx context.Context, c *app.RequestContext) { c.Set("console_session_id", session.ID); c.Next(ctx) }, s.seedPublicAgents)
	call := func() {
		raw := []byte(`{"kind":"celebrity","activate_new":true}`)
		r := ut.PerformRequest(h.Engine, "POST", "/seed", &ut.Body{Body: bytes.NewReader(raw), Len: len(raw)}, ut.Header{Key: "Content-Type", Value: "application/json"}).Result()
		if r.StatusCode() != 200 {
			t.Fatal(r.StatusCode(), string(r.Body()))
		}
	}
	call()
	var count int64
	check(db.Raw("SELECT count(*) FROM managed_members WHERE sponsor_uid=?", owner).Scan(&count).Error)
	if count != 93 {
		t.Fatal("roster provisioning duplicated or re-created retired slots", count)
	}
	check(db.Raw(`SELECT count(*) FROM managed_members m JOIN agent_owners o USING(agent_id) JOIN twin_users t ON t.user_id=o.owner_uid JOIN agent_avatars a ON a.agent_id=m.agent_id WHERE m.sponsor_uid=? AND m.seed_index>=20105 AND m.enabled AND t.portrait_fields->>'avatar'='/api/v2/public/avatars/'||a.avatar_id`, owner).Scan(&count).Error)
	if count != 14 {
		t.Fatal("new characters missing enabled identity/avatar", count)
	}
	check(db.Exec("UPDATE managed_members SET enabled=false,name='keep operator name' WHERE agent_id=?", id).Error)
	call()
	check(db.Raw("SELECT count(*) FROM managed_members WHERE sponsor_uid=?", owner).Scan(&count).Error)
	if count != 93 {
		t.Fatal("repeated apply duplicated identities", count)
	}
	check(db.Raw("SELECT enabled,deleted_at,name FROM managed_members WHERE agent_id=?", id).Scan(&state).Error)
	if state.Enabled || state.Name != "keep operator name" {
		t.Fatal("apply overwrote operator choices", state)
	}
}
