package consolev2

import (
	"net/http"
	"testing"

	"elsewhere_server/pkg/config"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestConsoleMultipleOrigins(t *testing.T) {
	primary := "https://inspiralai.com"
	secondary := "https://preview.example.test"
	for _, tc := range []struct {
		name, origin, host string
		allowed            bool
	}{
		{"primary", primary, "inspiralai.com", true},
		{"secondary", secondary, "preview.example.test", true},
		{"cross trusted domains", primary, "preview.example.test", false},
		{"reverse cross trusted domains", secondary, "inspiralai.com", false},
		{"unknown same host", "https://evil.test", "evil.test", false},
		{"suffix attack", "https://inspiralai.com.evil.test", "preview.example.test.evil.test", false},
		{"insecure", "http://preview.example.test", "preview.example.test", false},
		{"wrong port", "https://inspiralai.com:444", "preview.example.test:444", false},
		{"missing", "", "preview.example.test", false},
		{"null", "null", "preview.example.test", false},
		{"path", secondary + "/path", "preview.example.test", false},
		{"query", secondary + "?", "preview.example.test", false},
		{"fragment", secondary + "#", "preview.example.test", false},
		{"credentials", "https://user@preview.example.test", "preview.example.test", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validConsoleSameOrigin(tc.origin, tc.host, primary, secondary); got != tc.allowed {
				t.Fatalf("REST allowed=%v", got)
			}
			if got := validConsoleWebSocketRequest(tc.origin, tc.host, consoleV2WebSocketProtocol, "", primary, secondary); got != tc.allowed {
				t.Fatalf("WebSocket allowed=%v", got)
			}
		})
	}
	if validConsoleSameOrigin(secondary, "preview.example.test", primary) {
		t.Fatal("secondary trusted without configuration")
	}
	if validConsoleWebSocketRequest(secondary, "preview.example.test", consoleV2WebSocketProtocol, "secret", primary, secondary) {
		t.Fatal("query token accepted")
	}
	if validConsoleWebSocketRequest(secondary, "preview.example.test", "legacy", "", primary, secondary) {
		t.Fatal("wrong protocol accepted")
	}
}

func TestConsoleOriginConfigurationAndLogin(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{ConsoleV2PublicURL: "https://inspiralai.com", ConsoleV2OTPPepper: "test", ConsoleV2AllowedOrigins: []string{"https://preview.example.test"}}
	svc, err := NewService(db, &fixedIDGenerator{}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if svc.publicURL != cfg.ConsoleV2PublicURL || !svc.secureCookie {
		t.Fatal("canonical handoff or cookie policy changed")
	}
	h := server.New(server.WithHostPorts("127.0.0.1:0"))
	svc.Register(h)
	for _, host := range []string{"inspiralai.com", "preview.example.test"} {
		status, payload, _ := performJSON(t, h, http.MethodPost, "https://"+host+"/api/v2/auth/email/challenges", map[string]interface{}{}, ut.Header{Key: "Origin", Value: "https://" + host})
		if status != http.StatusBadRequest || responseErrorCode(t, payload) != "INVALID_REQUEST" {
			t.Fatalf("%s: %d %#v", host, status, payload)
		}
	}
	for _, bad := range []string{"https://*.example.test", "http://preview.example.test", "https://inspiralai.com/path", "https://inspiralai.com?x=1", "https://user@preview.example.test", "https://inspiralai.com#fragment", "null"} {
		cfg.ConsoleV2AllowedOrigins = []string{bad}
		if _, err := NewService(db, &fixedIDGenerator{}, cfg); err == nil {
			t.Fatalf("invalid configured origin accepted: %s", bad)
		}
	}
}
