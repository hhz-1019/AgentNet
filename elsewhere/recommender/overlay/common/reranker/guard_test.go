package reranker

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "ranking-tests-")
	if err != nil {
		panic(err)
	}
	os.Setenv("RERANKER_BUDGET_DB", filepath.Join(dir, "ledger.db"))
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func TestGuardPersistenceConcurrencyAndLimits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")
	t.Setenv("RERANKER_BUDGET_DB", path)
	t.Setenv("RERANKER_DAILY_CALL_LIMIT", "2")
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		time.Sleep(20 * time.Millisecond)
		json.NewEncoder(w).Encode(RerankResponse{Results: []RerankResult{{Index: 0, RelevanceScore: 0.8}}})
	}))
	defer server.Close()
	req := RerankRequest{Model: "test", Query: "one", Documents: []string{"doc"}}
	// Separate clients/connections emulate overlapping workers and process restarts.
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); NewClient("test", server.URL).Rerank(context.Background(), req) }()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("duplicate external calls: %d", calls.Load())
	}
	if _, err := NewClient("test", server.URL).Rerank(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	req.Query = "two"
	if _, err := NewClient("test", server.URL).Rerank(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	req.Query = "three"
	if _, err := NewClient("test", server.URL).Rerank(t.Context(), req); err == nil {
		t.Fatal("budget bypass")
	}
	if calls.Load() != 2 {
		t.Fatalf("budget exceeded: %d", calls.Load())
	}
	db, _ := sql.Open("sqlite", path)
	defer db.Close()
	var n, tokens int
	if err := db.QueryRow("SELECT calls,tokens FROM daily_budget").Scan(&n, &tokens); err != nil {
		t.Fatal(err)
	}
	if n != 2 || tokens <= 0 {
		t.Fatalf("bad durable ledger %d %d", n, tokens)
	}
	// Previous dates do not consume today's budget; UTC+8 is used by the guard.
	db.Exec("UPDATE daily_budget SET day='2000-01-01'")
	if _, err := NewClient("test", server.URL).Rerank(t.Context(), req); err != nil {
		t.Fatal(err)
	}
}

func TestGuardFailureCooldownAndFailClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")
	t.Setenv("RERANKER_BUDGET_DB", path)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "failure", 503) }))
	defer server.Close()
	req := RerankRequest{Query: "failure", Documents: []string{"doc"}}
	for range 3 {
		if _, err := NewClient("test", server.URL).Rerank(t.Context(), req); err == nil {
			t.Fatal("expected failure")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("failed requests retried before cooldown")
	}
	t.Setenv("RERANKER_BUDGET_DB", filepath.Join(t.TempDir(), "missing", "db"))
	if _, err := NewClient("test", server.URL).Rerank(t.Context(), req); err == nil {
		t.Fatal("missing ledger did not fail closed")
	}
	if calls.Load() != 1 {
		t.Fatal("external call without durable reservation")
	}
}

func TestGuardTokenBudgetAndInvalidConfiguration(t *testing.T) {
	for _, limit := range []string{"0", "1", "-1", "invalid"} {
		t.Run(fmt.Sprint(limit), func(t *testing.T) {
			t.Setenv("RERANKER_BUDGET_DB", filepath.Join(t.TempDir(), "ledger.db"))
			t.Setenv("RERANKER_DAILY_TOKEN_LIMIT", limit)
			var calls int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
			defer server.Close()
			_, err := NewClient("test", server.URL).Rerank(t.Context(), RerankRequest{Documents: []string{"doc"}})
			if err == nil || calls != 0 {
				t.Fatal("token guard failed before HTTP")
			}
		})
	}
}
