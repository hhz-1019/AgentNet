package embedding

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDisabledPreventsProviderRequests(t *testing.T) {
	t.Setenv("EMBEDDING_DISABLED", "true")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer server.Close()
	client := NewClient("openai", "test", server.URL, "old-model", 1024)
	_, err := client.GetEmbedding(context.Background(), "test")
	if !errors.Is(err, ErrDisabled) || calls != 0 {
		t.Fatalf("disabled provider called: calls=%d err=%v", calls, err)
	}
}
