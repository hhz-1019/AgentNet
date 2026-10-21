package reranker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatRankingBatchesAndTopN(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer shared-test" {
			t.Error("wrong shared endpoint or credential")
		}
		var body struct {
			Messages []struct{ Content string }
			Thinking struct{ Type string }
			Model    string
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Thinking.Type != "disabled" || body.Model != "test-model" {
			t.Error("wrong model settings")
		}
		var input struct{ Documents []string }
		json.Unmarshal([]byte(body.Messages[1].Content), &input)
		scores := []map[string]any{}
		for i := range input.Documents {
			scores = append(scores, map[string]any{"index": i, "relevance_score": float64(calls) / 10})
		}
		content, _ := json.Marshal(map[string]any{"results": scores})
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": string(content)}}}, "usage": map[string]int{"total_tokens": 10}})
	}))
	defer server.Close()
	docs := make([]string, 33)
	for i := range docs {
		docs[i] = "full public content"
	}
	result, err := NewClient("shared-test", server.URL+"/chat/completions").rankChat(context.Background(), RerankRequest{Model: "test-model", Documents: docs, TopN: 2})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(result.Results) != 2 || result.Results[0].Index != 32 || result.Usage.TotalTokens != 20 {
		t.Fatalf("wrong batch mapping: %+v", result)
	}
}

func TestChatRankingRejectsInvalidResults(t *testing.T) {
	for _, content := range []string{
		`{"results":[{"index":0,"relevance_score":0.8},{"index":0,"relevance_score":0.3}]}`,
		`{"results":[{"index":0,"relevance_score":0.8}]}`,
		`{"results":[{"index":0,"relevance_score":0.8},{"index":2,"relevance_score":0.3}]}`,
		`{"results":[{"index":0},{"index":1,"relevance_score":0.3}]}`,
		`{"results":[{"index":0,"relevance_score":2},{"index":1,"relevance_score":0.3}]}`,
		`not json`,
	} {
		t.Run(content, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": content}}}})
			}))
			defer server.Close()
			_, err := NewClient("test", server.URL+"/chat/completions").rankChat(context.Background(), RerankRequest{Documents: []string{"a", "b"}})
			if err == nil {
				t.Fatal("accepted invalid scores")
			}
		})
	}
}

func TestChatRankingNoFallbackOrSecretLeak(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(429)
		w.Write([]byte("private-provider-body"))
	}))
	defer server.Close()
	client := NewClient("test", server.URL+"/chat/completions")
	_, err := client.rankChat(context.Background(), RerankRequest{Documents: []string{"a"}})
	if err == nil || strings.Contains(err.Error(), "private") || calls != 1 {
		t.Fatal("unsafe retry/error")
	}
	_, err = client.rankChat(context.Background(), RerankRequest{Documents: []string{strings.Repeat("a", 120001)}})
	if err == nil || calls != 1 {
		t.Fatal("oversized input sent")
	}
}
