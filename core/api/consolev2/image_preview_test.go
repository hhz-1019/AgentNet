package consolev2

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func previewTestImage(t *testing.T, w, h int) []byte {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			im.SetRGBA(x, y, color.RGBA{40, 120, 180, 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestElsewhereImagePreviewRaster(t *testing.T) {
	for _, size := range [][2]int{{120, 80}, {80, 120}, {1, 1}, {2, 1}} {
		p := makeImagePreview(previewTestImage(t, size[0], size[1]))
		if p.Width != size[0] || p.Height != size[1] || p.Color != "#2878b4" {
			t.Fatalf("bad metadata: %+v", p)
		}
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(p.Preview, "data:image/jpeg;base64,"))
		if err != nil {
			t.Fatal(err)
		}
		config, err := jpeg.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width > 24 || config.Height > 24 || len(p.Preview) > 2048 {
			t.Fatalf("preview isn't small: %+v %v", config, err)
		}
	}
	for _, invalid := range [][]byte{nil, []byte("broken"), []byte(`<svg onload="alert(1)"></svg>`), make([]byte, (8<<20)+1)} {
		if p := makeImagePreview(invalid); p != (imagePreview{}) {
			t.Fatalf("invalid raster accepted: %+v", p)
		}
	}
}
