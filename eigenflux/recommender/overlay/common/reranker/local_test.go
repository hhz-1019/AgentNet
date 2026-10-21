package reranker

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type localTransport func(*http.Request) (*http.Response, error)

func (f localTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestLocalRankingCannotCallProviderAndDoesNotUsePaidBudget(t *testing.T) {
	t.Setenv("RERANKER_MODE", "local")
	t.Setenv("RERANKER_DAILY_CALL_LIMIT", "0")
	t.Setenv("RERANKER_DAILY_TOKEN_LIMIT", "0")
	calls := 0
	c := NewClient("old-provider-secret", localEndpoint)
	c.httpClient.Transport = localTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != localEndpoint {
			t.Fatal("unexpected outbound destination")
		}
		if strings.Contains(r.Header.Get("Authorization"), "old-provider-secret") {
			t.Fatal("provider credential leaked")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"results":[{"index":0,"relevance_score":1}]}`)), Header: make(http.Header)}, nil
	})
	req := RerankRequest{Query: "q", Documents: []string{"d"}}
	result, err := c.Rerank(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if result.Results[0].RelevanceScore != 1 {
		t.Fatal("score was not decoded")
	}
	c.url = "https://api.deepseek.com/chat/completions"
	if _, err := c.Rerank(context.Background(), req); err == nil {
		t.Fatal("external destination accepted")
	}
	if calls != 1 {
		t.Fatal("unexpected calls")
	}
	c.url = localEndpoint
	req.Documents = make([]string, 501)
	if _, err := c.Rerank(context.Background(), req); err == nil {
		t.Fatal("unbounded input")
	}
}
