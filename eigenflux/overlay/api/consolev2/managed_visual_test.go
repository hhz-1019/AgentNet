package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestManagedRealPhotoCollection(t *testing.T) {
	raw, err := managedPhotoFiles.ReadFile("managed_photos/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var photos []managedPhoto
	if err = json.Unmarshal(raw, &photos); err != nil {
		t.Fatal(err)
	}
	if len(photos) < 12 {
		t.Fatal("missing subject diversity")
	}
	for _, p := range photos {
		t.Run(p.ID, func(t *testing.T) {
			if !photoSafe(p) {
				t.Fatal("missing safe attribution", p.ID)
			}
			raw, err := managedPhotoFiles.ReadFile("managed_photos/" + p.File)
			if err != nil {
				t.Fatal(err)
			}
			data, err := cleanManagedPhoto(raw)
			if err != nil {
				t.Fatal(err)
			}
			cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || format != "jpeg" || cfg.Width < 600 || cfg.Height < 350 {
				t.Fatal("not usable photography")
			}
		})
	}
	for _, bad := range []string{"<svg><text>文字卡片</text></svg>", "<html>error</html>", ""} {
		if _, err := cleanManagedPhoto([]byte(bad)); err == nil {
			t.Fatal("non-photo accepted")
		}
	}
	for _, bad := range []string{"http://upload.wikimedia.org/a.jpg", "https://upload.wikimedia.org.evil.test/a.jpg", "https://user@upload.wikimedia.org/a.jpg", "https://127.0.0.1/a.jpg", "https://upload.wikimedia.org:443/a.jpg"} {
		if photoURL(bad, "upload.wikimedia.org") {
			t.Fatal("unsafe host accepted", bad)
		}
	}
	if photoLicense("All rights reserved") || photoLicense("CC BY-NC 4.0") {
		t.Fatal("unlicensed media accepted")
	}
}
func TestManagedPhotoFallbackAndRelevance(t *testing.T) {
	for _, item := range []struct{ title, scene, theme string }{{"植物盆栽观察", "城市兴趣", "plants"}, {"校园社团交友", "校园交友", "campus"}, {"实验室复现记录", "科研交流", "laboratory"}, {"桌游规则", "城市兴趣", "boardgame"}} {
		d := socialDocument{Title: item.title}
		p, err := selectManagedPhoto(context.Background(), d, item.scene, "https://evil.test/image.svg", 1)
		if err != nil || p.ID != item.theme || len(p.Content) == 0 {
			t.Fatal("fallback not relevant", item, err)
		}
	}
}

func TestManagedPhotoSearchDownloadAndOutage(t *testing.T) {
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	raw, err := managedPhotoFiles.ReadFile("managed_photos/campus.jpg")
	if err != nil {
		t.Fatal(err)
	}
	requests := 0
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.Host == "commons.wikimedia.org" {
			if r.URL.Query().Get("gsrnamespace") != "6" || !strings.Contains(r.URL.Query().Get("iiprop"), "metadata") {
				t.Fatal("missing photography metadata")
			}
			body := `{"query":{"pages":{"1":{"title":"File:Campus photograph.jpg","index":1,"imageinfo":[{"thumburl":"https://thumb.wikimedia.org/campus.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Campus_photograph.jpg","mime":"image/jpeg","width":1200,"height":800,"metadata":[{"name":"Make","value":"camera"}],"extmetadata":{"Artist":{"value":"Photographer"},"LicenseShortName":{"value":"CC BY 4.0"},"LicenseUrl":{"value":"https://creativecommons.org/licenses/by/4.0/"}}}]}}}}`
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		}
		if r.URL.Host != "thumb.wikimedia.org" {
			t.Fatal("unexpected download host", r.URL.Host)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
	})
	p, err := selectManagedPhoto(context.Background(), socialDocument{Title: "校园"}, "校园交友", "unique test campus", 1)
	if err != nil || p.Author != "Photographer" || len(p.Content) == 0 || requests != 2 {
		t.Fatal("search did not download a photo", err, requests)
	}
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) { return nil, errors.New("offline") })
	p, err = selectManagedPhoto(context.Background(), socialDocument{Title: "校园"}, "校园交友", "unique offline campus", 1)
	if err != nil || p.ID != "campus" || len(p.Content) == 0 {
		t.Fatal("outage lost real photo", err)
	}
}
