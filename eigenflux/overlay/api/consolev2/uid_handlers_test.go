package consolev2

import (
	"github.com/cloudwego/hertz/pkg/app"
	"testing"
	"time"
)

func TestUIDPasswordBounds(t *testing.T) {
	for _, value := range []string{"", "12345678901"} {
		if validOwnerPassword(value) {
			t.Fatal("short password accepted")
		}
	}
	if !validOwnerPassword("123456789012") {
		t.Fatal("valid password rejected")
	}
	if validOwnerPassword(string(make([]byte, 73))) {
		t.Fatal("bcrypt truncation permitted")
	}
}
func TestUIDRecentAuth(t *testing.T) {
	now := time.Now().UnixMilli()
	c := app.NewContext(0)
	c.Set("console_auth_method", "handoff")
	c.Set("console_recent_auth_at", now)
	if requireRecentEmailAuth(c, now) {
		t.Fatal("runtime handoff counted as human authentication")
	}
	c.Set("console_auth_method", "uid_password")
	if !requireRecentEmailAuth(c, now) {
		t.Fatal("UID owner authentication rejected")
	}
	if requireRecentEmailAuth(c, now+int64(6*time.Minute/time.Millisecond)) {
		t.Fatal("stale authentication accepted")
	}
}
