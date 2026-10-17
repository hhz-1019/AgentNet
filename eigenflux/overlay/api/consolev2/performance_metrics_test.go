package consolev2

import (
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"strings"
	"testing"
)

func TestElsewherePerformanceMetricValidation(t *testing.T) {
	h := server.New()
	s := &Service{}
	h.POST("/performance", s.performanceMetric)
	cases := []struct {
		origin, body string
		status       int
	}{
		{"http://example.com", `{"name":"LCP","value":1400,"route":"explore","device":"mobile"}`, 204},
		{"http://evil.example", `{"name":"LCP","value":1400,"route":"explore","device":"mobile"}`, 403},
		{"http://example.com", `{"name":"LCP","value":1400,"route":"person/123","device":"mobile"}`, 400},
		{"http://example.com", `{"name":"LCP","value":-1,"route":"explore","device":"mobile"}`, 400},
		{"http://example.com", `{"name":"SECRET","value":1,"route":"explore","device":"mobile"}`, 400},
	}
	for _, tt := range cases {
		r := ut.PerformRequest(h.Engine, "POST", "http://example.com/performance", &ut.Body{Body: strings.NewReader(tt.body), Len: len(tt.body)}, ut.Header{Key: "Origin", Value: tt.origin}, ut.Header{Key: "Content-Type", Value: "application/json"}).Result()
		if r.StatusCode() != tt.status {
			t.Fatalf("%s: %d want %d", tt.body, r.StatusCode(), tt.status)
		}
	}
}
