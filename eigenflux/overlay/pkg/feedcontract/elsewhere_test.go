package feedcontract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestElsewhereContractDoesNotDependOnUpstreamStaticAssets(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "static"), 0700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "static/feed_contract.md"), []byte("the bar is deliberately low"), 0600)
	t.Chdir(dir)
	for _, mode := range []string{"baseline", "intent_aligned"} {
		got := ElsewhereForMode(mode)
		if !strings.Contains(got, "host-context-2026-10-16") || strings.Contains(got, "deliberately low") {
			t.Fatal(got)
		}
		if strings.Contains(got, "READ-ONLY OUTPUT CONTRACT") != (mode == "baseline") {
			t.Fatal("wrong onboarding contract")
		}
	}
}
