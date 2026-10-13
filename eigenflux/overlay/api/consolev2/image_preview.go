package consolev2

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
)

type imagePreview struct {
	Width   int
	Height  int
	Preview string
	Color   string
}

// Decode only bounded raster images. No remote fetch, SVG execution or full
// resolution image is sent as a placeholder. The preview's long edge is 24px.
func makeImagePreview(data []byte) imagePreview {
	if len(data) > 8<<20 {
		return imagePreview{}
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 12000 || config.Height > 12000 || int64(config.Width)*int64(config.Height) > 24000000 {
		return imagePreview{}
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return imagePreview{}
	}
	edge := min(24, max(config.Width, config.Height))
	w, h := edge, edge
	if config.Width >= config.Height {
		h = max(1, config.Height*edge/config.Width)
	} else {
		w = max(1, config.Width*edge/config.Height)
	}
	tiny := image.NewRGBA(image.Rect(0, 0, w, h))
	type bucket struct{ count, r, g, b int }
	buckets := map[int]bucket{}
	bounds := source.Bounds()
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// Box sampling retains the source's color composition, including
			// fine details that a single nearest-neighbour sample could miss.
			x0, x1 := x*config.Width/w, (x+1)*config.Width/w
			y0, y1 := y*config.Height/h, (y+1)*config.Height/h
			var r, g, b, n uint64
			for sy := y0; sy < y1; sy += max(1, (y1-y0)/8) {
				for sx := x0; sx < x1; sx += max(1, (x1-x0)/8) {
					rr, gg, bb, aa := source.At(bounds.Min.X+sx, bounds.Min.Y+sy).RGBA()
					r += uint64((rr + 65535 - aa) >> 8)
					g += uint64((gg + 65535 - aa) >> 8)
					b += uint64((bb + 65535 - aa) >> 8)
					n++
				}
			}
			c := color.RGBA{uint8(r / n), uint8(g / n), uint8(b / n), 255}
			tiny.SetRGBA(x, y, c)
			key := int(c.R>>4)<<8 | int(c.G>>4)<<4 | int(c.B>>4)
			v := buckets[key]
			v.count++
			v.r += int(c.R)
			v.g += int(c.G)
			v.b += int(c.B)
			buckets[key] = v
		}
	}
	var dominant bucket
	best := -1
	for key, v := range buckets {
		if v.count > dominant.count || (v.count == dominant.count && key < best) {
			dominant, best = v, key
		}
	}
	var encoded bytes.Buffer
	if jpeg.Encode(&encoded, tiny, &jpeg.Options{Quality: 35}) != nil {
		return imagePreview{}
	}
	return imagePreview{config.Width, config.Height, "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes()), fmt.Sprintf("#%02x%02x%02x", dominant.r/dominant.count, dominant.g/dominant.count, dominant.b/dominant.count)}
}
