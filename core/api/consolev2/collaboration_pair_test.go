package consolev2

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCollaborationPairDiscovery(t *testing.T) {
	dsn := os.Getenv("AGENTNET_COLLABORATION_TEST_DSN")
	if dsn == "" {
		t.Skip("SQL fixture required")
	}
	db := collaborationFixtureDB(t, dsn)
	s := &Service{db: db}
	for _, sql := range []string{"ALTER TABLE agents ADD COLUMN IF NOT EXISTS short_id TEXT", "ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_name TEXT", "UPDATE agents SET short_id='PeerB',agent_name='Same name' WHERE agent_id=2"} {
		if e := db.Exec(sql).Error; e != nil {
			t.Fatal(e)
		}
	}
	for _, short := range []string{"PeerB", "@PeerB"} {
		result, e := s.collaborationOperation("project", "1", collaborationRequest{Action: "resolve", ShortID: short})
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(result)
		if !strings.Contains(string(raw), `"agent_id":"2"`) || strings.Contains(string(raw), "owner") {
			t.Fatalf("unsafe resolution %s", raw)
		}
	}
	for _, short := range []string{"Same name", "peerb", "a@example.com", "Peer%", "Absent"} {
		if _, e := s.collaborationOperation("project", "1", collaborationRequest{Action: "resolve", ShortID: short}); e == nil {
			t.Fatalf("resolved ambiguous/invalid %s", short)
		}
	}
	if !collabRead("project", "resolve") {
		t.Fatal("resolve must require read scope")
	}
	if e := db.Exec("UPDATE agents SET identity_state='deleted' WHERE agent_id=2").Error; e != nil {
		t.Fatal(e)
	}
	defer db.Exec("UPDATE agents SET identity_state='active' WHERE agent_id=2")
	if _, e := s.collaborationOperation("project", "1", collaborationRequest{Action: "resolve", ShortID: "PeerB"}); e == nil {
		t.Fatal("resolved deleted identity")
	}
}
