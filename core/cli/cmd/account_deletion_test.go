package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"elsewhere.local/cli/internal/cache"
	"elsewhere.local/cli/internal/config"
)

func TestAccountDeletionResumesLocalCleanup(t *testing.T) {
	config.SetHomeDir(t.TempDir())
	t.Cleanup(func() { config.SetHomeDir("") })
	dir := cache.ServerDir("agentnet")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	state := deletedConnection{Status: "deleted", Endpoint: "https://test.invalid", AgentID: "123", LocalCleanup: "pending", SchedulerAction: "stop_account_patrol"}
	if err := saveDeletionMarker("agentnet", state); err != nil {
		t.Fatal(err)
	}
	// A nonempty directory occupying a credential file forces a real cleanup
	// failure. The pending marker survives and blocks all network activity.
	blocked := filepath.Join(dir, "credentials.json")
	if err := os.MkdirAll(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blocked, "obstacle"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := resumeConnectionDeletion("agentnet"); err == nil || isDeletedAccountError(err) {
		t.Fatal("incomplete cleanup accepted", err)
	}
	if err := os.Remove(filepath.Join(blocked, "obstacle")); err != nil {
		t.Fatal(err)
	}
	if err := resumeConnectionDeletion("agentnet"); !isDeletedAccountError(err) {
		t.Fatal("cleanup did not resume", err)
	}
	raw, err := os.ReadFile(deletionMarkerPath("agentnet"))
	if err != nil {
		t.Fatal(err)
	}
	var saved deletedConnection
	if json.Unmarshal(raw, &saved) != nil || saved.LocalCleanup != "completed" || saved.AgentID != "" {
		t.Fatal("completed marker retained identity", string(raw))
	}
	if err := safeConnectionDirectory("../other"); err == nil {
		t.Fatal("traversal accepted")
	}
}
