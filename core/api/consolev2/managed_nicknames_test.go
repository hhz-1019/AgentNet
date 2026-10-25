package consolev2

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestManagedCelebrityNicknameMigration(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('nickname-owner',987654288,'!x','!x',1)`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654288")
	s := &Service{db: db, idgen: &managedTestIDs{id: 39980000}}
	catalog := celebrityCatalog()
	seen := map[string]bool{}
	for _, p := range catalog[105:] {
		if p.AgentName == "" || seen[p.AgentName] || strings.Contains(p.AgentName, "资讯 Agent") {
			t.Fatal("invalid nickname", p.Key)
		}
		seen[p.AgentName] = true
	}
	entries := map[int]managedPersona{}
	for _, i := range []int{0, 105, 106, 177} {
		p := catalog[i]
		if i == 105 {
			p.AgentName = "Tibo 的小铃铛"
		}
		if i == 106 {
			p.AgentName = "郑钦文的场边球童"
		}
		if i == 177 {
			p.AgentName = ""
		}
		entries[20000+i] = celebrityPersona(p)
	}
	_, err := s.provisionManagedEntries(context.Background(), "nickname-owner", entries)
	check(err)
	for _, i := range []int{0, 105, 106, 177} {
		check(db.Exec(`INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id) SELECT sponsor_uid,?,'celebrity',agent_id FROM managed_members WHERE sponsor_uid='nickname-owner' AND seed_index=?`, catalog[i].Key, 20000+i).Error)
	}
	// A name edited on either surface must not be overwritten.
	check(db.Exec(`UPDATE agents SET agent_name='运营者自选名字' WHERE agent_id=(SELECT agent_id FROM managed_members WHERE sponsor_uid='nickname-owner' AND seed_index=20106)`).Error)
	check(db.Exec(`UPDATE managed_members SET enabled=true,daily_limit=4,next_run_at=123456 WHERE sponsor_uid='nickname-owner'`).Error)
	raw, err := os.ReadFile("../../migrations/000155_celebrity_nicknames.sql")
	check(err)
	up := strings.Split(string(raw), "-- +goose Down")[0]
	for repeat := 0; repeat < 2; repeat++ {
		check(db.Exec(up).Error)
		var rows []struct {
			SeedIndex                 int
			Name, AgentName, TwinName string
			Enabled                   bool
			DailyLimit                int
			NextRunAt                 int64
		}
		check(db.Raw(`SELECT m.seed_index,m.name,a.agent_name,u.name twin_name,m.enabled,m.daily_limit,m.next_run_at FROM managed_members m JOIN agents a USING(agent_id) JOIN twin_users u ON u.user_id=m.owner_uid WHERE m.sponsor_uid='nickname-owner' ORDER BY m.seed_index`).Scan(&rows).Error)
		if len(rows) != 4 {
			t.Fatal(rows)
		}
		for _, r := range rows {
			if !r.Enabled || r.DailyLimit != 4 || r.NextRunAt != 123456 {
				t.Fatal("activity state changed", r)
			}
			i := r.SeedIndex - 20000
			if i == 106 {
				if r.AgentName != "运营者自选名字" || r.Name != "郑钦文的场边球童" {
					t.Fatal("custom name overwritten", r)
				}
				continue
			}
			want := entries[r.SeedIndex].Name
			if i >= 105 {
				want = catalog[i].AgentName
			}
			if r.Name != want || r.AgentName != want || r.TwinName != want {
				t.Fatal("name surfaces inconsistent", r)
			}
		}
		var audits int
		check(db.Raw(`SELECT count(*) FROM managed_audit WHERE sponsor_uid='nickname-owner' AND action='celebrity_nickname_refresh'`).Scan(&audits).Error)
		if audits != 2 {
			t.Fatal("rename not idempotent", audits)
		}
	}
	var renamed string
	check(db.Raw(`SELECT pg_temp.celebrity_nickname_json('{"name":"旧名","bio":"旧名","nested":{"agent_name":"旧名"}}'::jsonb,'旧名','新名')::text`).Scan(&renamed).Error)
	if !strings.Contains(renamed, `"bio": "旧名"`) || strings.Contains(renamed, `"agent_name": "旧名"`) {
		t.Fatal("name-only boundary", renamed)
	}
}
