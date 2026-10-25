package metrics

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
)

func HertzMiddleware() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		HTTPRequestsInFlight.Inc()
		defer HTTPRequestsInFlight.Dec()
		start := time.Now()

		c.Next(ctx)

		duration := time.Since(start).Seconds()
		// Handler time (including its dependencies), not response transfer time.
		// Never modify headers after an event stream has started.
		if !strings.HasPrefix(string(c.Response.Header.ContentType()), "text/event-stream") && !c.Hijacked() {
			c.Response.Header.Add("Server-Timing", "app;dur="+strconv.FormatFloat(duration*1000, 'f', 2, 64))
		}
		method := string(c.Method())
		path := c.FullPath()
		if path == "" {
			path = "not_found"
		}
		status := strconv.Itoa(c.Response.StatusCode())

		HTTPRequestDuration.WithLabelValues(method, path, status).Observe(duration)
		HTTPRequestsTotal.WithLabelValues(method, path, status).Inc()
	}
}
