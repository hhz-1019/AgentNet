package metrics

import (
	"context"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"strings"
	"testing"
)

func TestHTTPApplicationTiming(t *testing.T) {
	h := server.New()
	h.Use(HertzMiddleware())
	h.GET("/ok", func(ctx context.Context, c *app.RequestContext) { c.String(200, "unchanged") })
	h.GET("/failure", func(ctx context.Context, c *app.RequestContext) { c.String(403, "denied") })
	h.GET("/stream", func(ctx context.Context, c *app.RequestContext) {
		c.Data(200, "text/event-stream", []byte(": heartbeat\n\n"))
	})
	for _, tc := range []struct {
		path, body string
		status     int
		timing     bool
	}{
		{"/ok", "unchanged", 200, true}, {"/failure", "denied", 403, true}, {"/stream", ": heartbeat\n\n", 200, false},
	} {
		r := ut.PerformRequest(h.Engine, "GET", tc.path, nil)
		if r.Code != tc.status || r.Body.String() != tc.body {
			t.Fatalf("%s: %d %s", tc.path, r.Code, r.Body.String())
		}
		if strings.HasPrefix(r.Header().Get("Server-Timing"), "app;dur=") != tc.timing {
			t.Fatal(r.Header())
		}
	}
}
