package consolev2

import (
	"context"
	"eigenflux_server/pkg/metrics"
	"encoding/json"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"math"
	"net/url"
	"sync"
	"time"
)

var browserPerformance = promauto.With(metrics.Registry).NewHistogramVec(prometheus.HistogramOpts{
	Name: "elsewhere_browser_performance", Help: "Browser timing in seconds; CLS is unitless. Fixed labels only.",
	Buckets: []float64{.01, .05, .1, .2, .5, 1, 2, 2.5, 4, 8, 15, 30, 60},
}, []string{"metric", "route", "device"})
var performanceBudget = struct {
	sync.Mutex
	second int64
	count  int
}{}

func (s *Service) performanceMetric(_ context.Context, c *app.RequestContext) {
	// Aggregate untrusted measurements, never persist individual visits.
	origin, err := url.Parse(string(c.GetHeader("Origin")))
	if err != nil || origin.Host == "" || origin.Host != string(c.Host()) {
		c.Status(403)
		return
	}
	if site := string(c.GetHeader("Sec-Fetch-Site")); site != "" && site != "same-origin" {
		c.Status(403)
		return
	}
	body, err := c.Body()
	if err != nil || len(body) > 512 {
		c.Status(400)
		return
	}
	var sample struct {
		Name   string  `json:"name"`
		Value  float64 `json:"value"`
		Route  string  `json:"route"`
		Device string  `json:"device"`
	}
	if json.Unmarshal(body, &sample) != nil || math.IsNaN(sample.Value) || math.IsInf(sample.Value, 0) || sample.Value < 0 || sample.Value > 60000 {
		c.Status(400)
		return
	}
	switch sample.Name {
	case "LCP", "INP", "TTFB", "ENTRY":
		sample.Value /= 1000
	case "CLS":
		if sample.Value > 10 {
			c.Status(400)
			return
		}
	default:
		c.Status(400)
		return
	}
	switch sample.Route {
	case "explore", "messages", "crossing", "person", "onboarding", "other":
	default:
		c.Status(400)
		return
	}
	if sample.Device != "mobile" && sample.Device != "desktop" {
		c.Status(400)
		return
	}
	performanceBudget.Lock()
	now := time.Now().Unix()
	if performanceBudget.second != now {
		performanceBudget.second = now
		performanceBudget.count = 0
	}
	performanceBudget.count++
	allowed := performanceBudget.count <= 100
	performanceBudget.Unlock()
	if !allowed {
		c.Status(429)
		return
	}
	browserPerformance.WithLabelValues(sample.Name, sample.Route, sample.Device).Observe(sample.Value)
	c.Header("Cache-Control", "no-store")
	c.Status(204)
}
