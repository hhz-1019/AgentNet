package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagedInformationCatalog(t *testing.T) {
	seen := map[int]bool{}
	for _, p := range informationCatalog() {
		entry, err := informationEntry(p)
		if err != nil {
			t.Fatalf("%s: %v", p.Key, err)
		}
		if seen[p.SeedIndex] {
			t.Fatal("duplicate slot")
		}
		seen[p.SeedIndex] = true
		for _, source := range p.Sources {
			if !strings.Contains(entry.Persona, source.URL) {
				t.Fatal("source missing from publication evidence")
			}
		}
		if !strings.Contains(entry.Persona, p.Unknowns) {
			t.Fatal("uncertainty lost")
		}
		end, _ := time.ParseInLocation("2006-01-02", p.ValidUntil, time.FixedZone("CST", 8*3600))
		if informationExpired(&p.SeedIndex, end.Add(-time.Second)) || !informationExpired(&p.SeedIndex, end) {
			t.Fatal("expiry boundary")
		}
		p.Sources = []RecruiterSource{{Title: "bad", URL: "http://example.com"}}
		if _, err := informationEntry(p); err == nil {
			t.Fatal("unsafe source accepted")
		}
	}
	ordinary := 20177
	if informationExpired(&ordinary, time.Now().AddDate(10, 0, 0)) {
		t.Fatal("ordinary identity expired")
	}
	for i := range recruitmentBoards {
		seed := 30000 + i
		if informationForSeed(&seed) != nil || informationExpired(&seed, time.Now().AddDate(10, 0, 0)) {
			t.Fatal("existing recruiter slot reused")
		}
	}
}

func TestManagedInformationRegistration(t *testing.T) {
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
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654287")
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('information-owner',987654287,'!x','!x',1); INSERT INTO managed_campaigns(sponsor_uid,enabled) VALUES('information-owner',true)`).Error)
	gen := &managedTestIDs{id: 39990000}
	now := time.Now()
	// Keep registration/queue tests independent of when CI runs; expiry itself
	// is covered with explicit boundary times above.
	original := informationCatalogJSON
	defer func() { informationCatalogJSON = original }()
	profiles := informationCatalog()
	for i := range profiles {
		profiles[i].CheckedAt = now.UTC().Format("2006-01-02")
		profiles[i].ValidUntil = now.AddDate(0, 0, 7).UTC().Format("2006-01-02")
	}
	informationCatalogJSON, _ = json.Marshal(profiles)
	if _, err := provisionInformationAgentsAt(context.Background(), db, gen, "987654286", now); err == nil {
		t.Fatal("allowlist bypass")
	}
	ids, err := provisionInformationAgentsAt(context.Background(), db, gen, "987654287", now)
	check(err)
	if len(ids) != len(informationCatalog()) {
		t.Fatal("missing identities")
	}
	var count int
	check(db.Raw(`SELECT count(*) FROM managed_members m JOIN agent_owners o USING(agent_id) JOIN owner_uid_numbers n ON n.owner_uid=m.owner_uid AND n.reserved_agent_id=m.agent_id JOIN agent_onboarding_v2 b USING(agent_id) JOIN agents a USING(agent_id) WHERE m.sponsor_uid='information-owner' AND o.owner_uid=m.owner_uid AND b.state='completed' AND NOT a.is_official AND m.enabled AND m.daily_limit=2 AND m.pending_action='post' AND m.pending_task_id LIKE 'information-launch:%' AND a.bio LIKE '%非原发布方授权账号%'`).Scan(&count).Error)
	if count != len(ids) {
		t.Fatal("real registration or queued launch missing", count)
	}
	s := &Service{db: db, idgen: gen}
	contacts := homeDiscoveryResponse{}
	check(s.appendRecruiterDiscovery(context.Background(), 1, &contacts))
	discovered := map[string]bool{}
	for _, item := range contacts.Items {
		discovered[item.AgentID] = true
	}
	for key, id := range ids {
		if !discovered[id] {
			t.Fatalf("new dossier missing from discovery: %s", key)
		}
	}
	beforeBlock := len(contacts.Items)
	check(db.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,created_at) VALUES(1,?,2,1)`, ids["nanjing-changcheng-1336156"]).Error)
	check(s.appendRecruiterDiscovery(context.Background(), 1, &contacts))
	if len(contacts.Items) != beforeBlock-1 {
		t.Fatal("blocked dossier leaked from cached discovery")
	}
	id := ids["papa-cofounder"]
	check(db.Exec(`UPDATE managed_members SET enabled=false,pending_task_id='',pending_topic='',pending_action='' WHERE agent_id=?`, id).Error)
	repeated, err := provisionInformationAgentsAt(context.Background(), db, gen, "987654287", now)
	check(err)
	if repeated["papa-cofounder"] != id {
		t.Fatal("retry changed identity")
	}
	check(db.Raw(`SELECT count(*) FROM managed_members WHERE agent_id=? AND NOT enabled AND pending_task_id=''`, id).Scan(&count).Error)
	if count != 1 {
		t.Fatal("retry reactivated or requeued identity")
	}
	if _, err := provisionInformationAgentsAt(context.Background(), db, gen, "987654287", now.AddDate(0, 1, 0)); err == nil {
		t.Fatal("expired catalog registered")
	}
	// Paused campaigns cannot leave partially registered identities behind.
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('information-paused',987654286,'!x','!x',1)`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654287,987654286")
	if _, err := provisionInformationAgentsAt(context.Background(), db, gen, "987654286", now); err == nil {
		t.Fatal("paused campaign bypass")
	}
	check(db.Raw(`SELECT count(*) FROM managed_members WHERE sponsor_uid='information-paused'`).Scan(&count).Error)
	if count != 0 {
		t.Fatal("partial registration escaped rollback")
	}
}
