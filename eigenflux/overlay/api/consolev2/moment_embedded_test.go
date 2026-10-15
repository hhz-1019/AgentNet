package consolev2

import (
	"strings"
	"testing"
	"github.com/cloudwego/hertz/pkg/app"
)

func TestMomentEmbeddedCookieIsolation(t *testing.T) {
	s := &Service{secureCookie: true}
	c := &app.RequestContext{}
	if s.setEmbeddedConsoleCookie(c, "session", "value", 60, true) { t.Fatal("ordinary browser cookie changed") }
	c.Request.Header.Set("X-Console-Embedded", "1")
	if !s.setEmbeddedConsoleCookie(c, "session", "value", 60, true) { t.Fatal("embedded cookie not set") }
	cookie := string(c.Response.Header.Peek("Set-Cookie"))
	for _, part := range []string{"Secure", "HttpOnly", "SameSite=None", "Partitioned"} {
		if !strings.Contains(cookie, part) { t.Fatalf("missing %s: %s", part, cookie) }
	}
	s.secureCookie = false
	if s.setEmbeddedConsoleCookie(c, "session", "value", 60, true) { t.Fatal("insecure embedded session allowed") }
}
