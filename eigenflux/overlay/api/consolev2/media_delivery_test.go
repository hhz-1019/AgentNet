package consolev2

import (
	"bytes"
	"context"
	"image"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
)

func TestSocialMediaResponsiveDelivery(t *testing.T) {
	source := previewTestImage(t, 1280, 854)
	small := resizedMedia(source, "image/png", 320)
	cfg, _, err := image.DecodeConfig(bytes.NewReader(small.data))
	if err != nil || cfg.Width != 320 || cfg.Height != 213 || len(small.data) >= len(source) {
		t.Fatalf("bad derivative: %+v %v %d/%d", cfg, err, len(small.data), len(source))
	}
	if got := resizedMedia(source, "image/png", 1440); !bytes.Equal(got.data, source) {
		t.Fatal("must not upscale")
	}
	h := server.New()
	allowed := true
	h.GET("/image", func(_ context.Context, c *app.RequestContext) {
		if !allowed {
			c.SetStatusCode(404)
			return
		}
		data, mime, unchanged := prepareMediaResponse(c, source, "image/png")
		if !unchanged {
			c.Data(200, mime, data)
		}
	})
	first := ut.PerformRequest(h.Engine, "GET", "/image?w=320", nil).Result()
	etag := string(first.Header.Peek("ETag"))
	if etag == "" || string(first.Header.Peek("Cache-Control")) != "private, no-cache" {
		t.Fatal("missing private validators")
	}
	second := ut.PerformRequest(h.Engine, "GET", "/image?w=320", nil, ut.Header{Key: "If-None-Match", Value: etag}).Result()
	if second.StatusCode() != 304 || len(second.Body()) != 0 {
		t.Fatal("cached image retransmitted")
	}
	original := ut.PerformRequest(h.Engine, "GET", "/image", nil, ut.Header{Key: "If-None-Match", Value: etag}).Result()
	if original.StatusCode() != 200 {
		t.Fatal("variant validator reused for original")
	}
	allowed = false
	revoked := ut.PerformRequest(h.Engine, "GET", "/image?w=320", nil, ut.Header{Key: "If-None-Match", Value: etag}).Result()
	if revoked.StatusCode() != 404 {
		t.Fatal("cache bypassed authorization")
	}
}
