package cmd

import (
	"cli.eigenflux.ai/internal/auth"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestElsewhereSocialOpportunities(t *testing.T) {
	reads := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		q := r.URL.Query()
		if r.Method != "GET" || r.URL.Path != "/api/v2/social/posts" || q.Get("scope") != "opportunities" || q.Get("exclude_ids") != `["369648989592621057"]` || q.Get("q") != "实习" {
			t.Errorf("recommendation arguments lost: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[],"ranking_version":"gorse-0.5.11"}}`))
	}))
	defer srv.Close()
	cfg, _ := runtimeTestConfig(t, srv.URL, true)
	if err := cfg.AddServer("agentnet", srv.URL); err != nil {
		t.Fatal(err)
	}
	if err := auth.SaveV2Credentials("agentnet", &auth.V2Credentials{AgentID: "1", AccessToken: "fixture", RefreshToken: "fixture", ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	oldServer, oldFormat := serverFlag, formatFlag
	serverFlag = "agentnet"
	formatFlag = "json"
	values := map[string]string{"scope": "opportunities", "exclude-ids": `["369648989592621057"]`, "query": "实习"}
	old := map[string]string{}
	for key, value := range values {
		old[key] = socialReadCmd.Flags().Lookup(key).Value.String()
		_ = socialReadCmd.Flags().Set(key, value)
	}
	t.Cleanup(func() {
		serverFlag, formatFlag = oldServer, oldFormat
		for key, value := range old {
			_ = socialReadCmd.Flags().Set(key, value)
		}
	})
	if _, err := captureHeartbeatStdout(t, func() error { return socialReadCmd.RunE(socialReadCmd, nil) }); err != nil {
		t.Fatal(err)
	}
	if reads != 1 {
		t.Fatal("expected one read", reads)
	}
}
