package consolev2

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strconv"
	"strings"
	"sync"

	"github.com/cloudwego/hertz/pkg/app"
)

type mediaVariant struct {
	data []byte
	mime string
}

var mediaVariants = struct {
	sync.Mutex
	values map[string]mediaVariant
	order  []string
	bytes  int
}{values: map[string]mediaVariant{}}
var mediaResizeSlots = make(chan struct{}, 2)

// Call ONLY after the request's current publication/ownership check succeeds.
// Private revalidation permits browser byte reuse without caching authorization.
func prepareMediaResponse(c *app.RequestContext, data []byte, mime string) ([]byte, string, bool) {
	width, _ := strconv.Atoi(string(c.Query("w")))
	if width == 320 || width == 640 || width == 960 || width == 1440 {
		variant := resizedMedia(data, mime, width)
		data, mime = variant.data, variant.mime
	}
	return data, mime, mediaUnchanged(c, mediaHash(data))
}

func mediaUnchanged(c *app.RequestContext, hash string) bool {
	etag := `"` + hash + `"`
	c.Header("Cache-Control", "private, no-cache")
	c.Header("ETag", etag)
	c.Header("Vary", "Cookie")
	for _, candidate := range strings.Split(string(c.GetHeader("If-None-Match")), ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == etag || candidate == "*" {
			c.SetStatusCode(304)
			return true
		}
	}
	return false
}

func resizedMedia(data []byte, mime string, width int) mediaVariant {
	original := mediaVariant{data, mime}
	if (mime != "image/jpeg" && mime != "image/png") || len(data) > 8<<20 {
		return original
	}
	key := fmt.Sprintf("%x:%d", sha256.Sum256(data), width)
	mediaVariants.Lock()
	cached, ok := mediaVariants.values[key]
	mediaVariants.Unlock()
	if ok {
		return cached
	}
	mediaResizeSlots <- struct{}{}
	defer func() { <-mediaResizeSlots }()
	mediaVariants.Lock()
	cached, ok = mediaVariants.values[key]
	mediaVariants.Unlock()
	if ok {
		return cached
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= width || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 16_000_000 {
		return original
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return original
	}
	height := max(1, cfg.Height*width/cfg.Width)
	target := image.NewRGBA(image.Rect(0, 0, width, height))
	bounds := source.Bounds()
	// Area samples keep fine text/lines legible and preserve PNG transparency.
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			x0, x1 := x*cfg.Width/width, (x+1)*cfg.Width/width
			y0, y1 := y*cfg.Height/height, (y+1)*cfg.Height/height
			var r, g, b, a, n uint64
			for sy := y0; sy < y1; sy += max(1, (y1-y0)/4) {
				for sx := x0; sx < x1; sx += max(1, (x1-x0)/4) {
					rr, gg, bb, aa := source.At(bounds.Min.X+sx, bounds.Min.Y+sy).RGBA()
					r += uint64(rr)
					g += uint64(gg)
					b += uint64(bb)
					a += uint64(aa)
					n++
				}
			}
			target.SetRGBA(x, y, color.RGBA{uint8(r / n >> 8), uint8(g / n >> 8), uint8(b / n >> 8), uint8(a / n >> 8)})
		}
	}
	var encoded bytes.Buffer
	// Opaque photo/illustration previews do not need lossless PNG. Original
	// downloads and transparent images retain their format and alpha channel.
	if mime == "image/png" && target.Opaque() {
		mime = "image/jpeg"
	}
	if mime == "image/png" {
		err = png.Encode(&encoded, target)
	} else {
		err = jpeg.Encode(&encoded, target, &jpeg.Options{Quality: 82})
	}
	if err != nil || encoded.Len() >= len(data) {
		return original
	}
	variant := mediaVariant{encoded.Bytes(), mime}
	mediaVariants.Lock()
	defer mediaVariants.Unlock()
	if cached, ok := mediaVariants.values[key]; ok {
		return cached
	}
	for len(mediaVariants.order) > 0 && (len(mediaVariants.order) >= 128 || mediaVariants.bytes+len(variant.data) > 24<<20) {
		oldest := mediaVariants.order[0]
		mediaVariants.order = mediaVariants.order[1:]
		mediaVariants.bytes -= len(mediaVariants.values[oldest].data)
		delete(mediaVariants.values, oldest)
	}
	mediaVariants.values[key] = variant
	mediaVariants.order = append(mediaVariants.order, key)
	mediaVariants.bytes += len(variant.data)
	return variant
}
