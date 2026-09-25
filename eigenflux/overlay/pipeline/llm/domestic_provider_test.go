package llm

import (
	"context"
	"eigenflux_server/pkg/config"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAgentNetArkResponsesPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/responses" {
			t.Errorf("incorrect Ark path: %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "ep-test" || body["reasoning"] != nil {
			t.Errorf("unexpected request: %v", body)
		}
		if r.Header.Get("Authorization") != "Bearer test-only" {
			t.Error("missing authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"response-test","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}`))
	}))
	defer server.Close()
	cfg := &config.Config{LLMApiKey: "test-only", LLMBaseURL: server.URL + "/api/v3", LLMModel: "ep-test", LLMReasoningEffort: "off", LLMMaxTokens: 512, SafetyLLMBaseURL: server.URL + "/api/v3"}
	for _, client := range []*Client{NewClient(cfg, nil), NewSafetyClient(cfg, nil)} {
		result, err := client.CallText(context.Background(), "test", "domestic-provider-test")
		if err != nil || result != "ok" {
			t.Fatalf("result=%q error=%v", result, err)
		}
	}
}
