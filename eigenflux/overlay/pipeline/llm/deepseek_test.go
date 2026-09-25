package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"eigenflux_server/pkg/config"
)

func TestAgentNetDeepSeekChatTransport(t *testing.T) {
	t.Setenv("LLM_API_STYLE", "chat_completions")
	for _, finish := range []string{"stop", "length"} {
		t.Run(finish, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-deepseek" {
					t.Errorf("wrong path or authentication")
				}
				var body struct {
					Model     string
					MaxTokens int `json:"max_tokens"`
					Thinking  struct{ Type string }
					Messages  []struct{ Role, Content string }
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body.Model != "deepseek-flash" || body.MaxTokens != 4096 || body.Thinking.Type != "disabled" || len(body.Messages) != 1 || body.Messages[0].Content != "test prompt" {
					t.Errorf("unexpected request: %+v", body)
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprintf(w, `{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"test response"},"finish_reason":%q}],"usage":{"completion_tokens":2}}`, finish)
			}))
			defer server.Close()
			cfg := &config.Config{LLMApiKey: "test-deepseek", LLMBaseURL: server.URL + "/v1", LLMModel: "deepseek-flash", LLMMaxTokens: 4096, LLMReasoningEffort: "off", SafetyLLMBaseURL: server.URL + "/v1"}
			for _, client := range []*Client{NewClient(cfg, nil), NewSafetyClient(cfg, nil)} {
				out, err := client.CallText(context.Background(), "test prompt", "test")
				if finish == "stop" && (err != nil || out != "test response") {
					t.Fatalf("%q %v", out, err)
				}
				if finish == "length" && err == nil {
					t.Fatal("truncated answer accepted")
				}
			}
			if calls != 2 {
				t.Fatalf("calls=%d", calls)
			}
		})
	}
}
