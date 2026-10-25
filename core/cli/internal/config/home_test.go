package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func fixtureHome(t *testing.T, root, name, endpoint string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(Config{DefaultServer: "agentnet", Servers: []Server{{Name: "agentnet", Endpoint: endpoint}}})
	if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "identity.key"), []byte("fixture-existing-identity"), 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestResolveHomePreservesExistingIdentity(t *testing.T) {
	root := t.TempDir()
	existing := fixtureHome(t, root, ".previous-home", "https://inspiralai.com")
	for _, input := range []string{root, filepath.Join(root, homeDirName), existing} {
		got, err := ResolveHome(input)
		if err != nil || got != existing {
			t.Fatalf("ResolveHome(%q) = %q, %v", input, got, err)
		}
	}
	if data, _ := os.ReadFile(filepath.Join(existing, "identity.key")); string(data) != "fixture-existing-identity" {
		t.Fatal("identity was changed")
	}
	if _, err := os.Stat(filepath.Join(root, homeDirName)); !os.IsNotExist(err) {
		t.Fatal("created a second identity Home")
	}
	SetHomeDir(existing)
	t.Cleanup(func() { SetHomeDir("") })
	if HomeDir() != existing {
		t.Fatal("explicit identity directory was nested again")
	}
}

func TestResolveHomeDoesNotAdoptAnotherNetworkOrSymlink(t *testing.T) {
	root := t.TempDir()
	fixtureHome(t, root, ".foreign-home", "https://other.example.test")
	want := filepath.Join(root, homeDirName)
	if got, err := ResolveHome(root); err != nil || got != want {
		t.Fatalf("adopted another network: %q %v", got, err)
	}
	outside := fixtureHome(t, t.TempDir(), "identity", "https://inspiralai.com")
	if err := os.Symlink(outside, filepath.Join(root, ".linked-home")); err != nil {
		t.Skip("symlink unavailable")
	}
	if got, err := ResolveHome(root); err != nil || got != want {
		t.Fatalf("followed an external symlink: %q %v", got, err)
	}
}

func TestResolveHomeRejectsAmbiguousIdentities(t *testing.T) {
	root := t.TempDir()
	a := fixtureHome(t, root, ".identity-a", "https://inspiralai.com")
	fixtureHome(t, root, ".identity-b", "https://inspiralai.com")
	if _, err := ResolveHome(root); err == nil {
		t.Fatal("silently chose between accounts")
	}
	if got, err := ResolveHome(a); err != nil || got != a {
		t.Fatalf("explicit account rejected: %q %v", got, err)
	}
}
