package embedding

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAgentNetBailianEmbeddingContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/compatible-mode/v1/embeddings" {
			t.Errorf("incorrect path: %s", r.URL.Path)
		}
		var body EmbeddingRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Model != "text-embedding-v4" || body.Dimensions != 1024 || body.EncodingFormat != "float" {
			t.Errorf("unexpected request: %+v", body)
		}
		if r.Header.Get("Authorization") != "Bearer test-only" {
			t.Error("missing authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"embedding": make([]float32, 1024), "index": 0}}})
	}))
	defer server.Close()
	client := NewClient("openai", "test-only", server.URL+"/compatible-mode/v1", "text-embedding-v4", 1024)
	vector, err := client.GetEmbedding(context.Background(), "测试")
	if err != nil || len(vector) != 1024 {
		t.Fatalf("dimensions=%d error=%v", len(vector), err)
	}
}
