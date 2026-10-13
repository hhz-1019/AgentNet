package consolev2

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestElsewhereAvatarDraftValidation(t *testing.T) {
	for _, id := range []string{"", "citrus", "bloom", "tide", "sprout", "spark", "orbit"} {
		if err := validatePortraitDraft(portraitDraft{Fields: map[string]string{"avatar": id}}); err != nil {
			t.Fatalf("valid avatar %s: %v", id, err)
		}
	}
	for _, id := range []string{"unknown", "../citrus", "https://example.com", "CITRUS"} {
		if err := validatePortraitDraft(portraitDraft{Fields: map[string]string{"avatar": id}}); err == nil {
			t.Fatalf("invalid avatar accepted: %s", id)
		}
	}
}

func TestElsewhereCustomAvatarRasterAndBounds(t *testing.T) {
	input := image.NewNRGBA(image.Rect(0, 0, 640, 480))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, input); err != nil {
		t.Fatal(err)
	}
	encoded.WriteString("trailing private metadata")
	result, err := prepareAvatar(base64.StdEncoding.EncodeToString(encoded.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(result))
	if err != nil || format != "png" || cfg.Width != 256 || cfg.Height != 256 || bytes.Contains(result, []byte("private metadata")) {
		t.Fatal("avatar was not sanitized/cropped")
	}
	for _, raw := range []string{base64.StdEncoding.EncodeToString([]byte("<svg onload='evil()'/>")), "not-base64", base64.StdEncoding.EncodeToString(make([]byte, (8<<20)+1))} {
		if _, err := prepareAvatar(raw); err == nil {
			t.Fatal("invalid input accepted")
		}
	}
	if !validPortraitAvatar(avatarPrefix+strings.Repeat("a", 32)) || validPortraitAvatar(avatarPrefix+"../secret") {
		t.Fatal("invalid public avatar path")
	}
}
