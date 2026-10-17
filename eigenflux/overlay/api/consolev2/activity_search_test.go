package consolev2

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestManagedActivitySearchConnector(t *testing.T) {
	var query string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query().Get("q")
		if r.URL.Path != "/search" || r.URL.Query().Get("format") != "json" {
			t.Error("wrong search contract")
		}
		fmt.Fprint(w, `{"results":[{"title":"原始材料","url":"https://example.com/article","content":"可继续核实的摘要"},{"url":"file:///private"},{"title":"重复","url":"https://example.com/article"}],"unresponsive_engines":[["engine","timeout"]]}`)
	}))
	defer server.Close()
	t.Setenv("AGENTNET_ACTIVITY_SEARCH_URL", server.URL)
	items, partial, err := activitySearch(context.Background(), "真实的具体问题")
	if err != nil || !partial || len(items) != 1 || query != "真实的具体问题" || items[0].Published != "" {
		t.Fatalf("unexpected search result: %+v %v %v", items, partial, err)
	}
	// The connector cannot redirect to an arbitrary private endpoint.
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, server.URL+"/search", 302) }))
	defer redirect.Close()
	t.Setenv("AGENTNET_ACTIVITY_SEARCH_URL", redirect.URL)
	if _, _, err := activitySearch(context.Background(), "query"); err == nil {
		t.Fatal("redirect followed")
	}
	t.Setenv("AGENTNET_ACTIVITY_SEARCH_URL", "")
	if _, _, err := activitySearch(context.Background(), "query"); err == nil {
		t.Fatal("missing capability hidden")
	}
}

func TestManagedActivityPublicPageLinks(t *testing.T) {
	links := activityPageLinks([]byte(`<a href="/jobs/42#apply">工程实习</a><a href="javascript:alert(1)">bad</a><a href="http://127.0.0.1/">bad</a>`), "https://example.com/careers")
	if len(links) != 1 {
		t.Fatalf("unexpected links: %+v", links)
	}
}

func TestManagedActivityImageSearchSelectionAndFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("categories") != "images" || r.URL.Query().Get("q") != "校园里的绿萝" {
			t.Error("image query/category lost")
		}
		fmt.Fprint(w, `{"results":[{"title":"叶片照片","url":"https://example.com/plants","img_src":"https://images.example.com/leaf.jpg"},{"url":"https://example.com/plants","img_src":"https://images.example.com/leaf.jpg"},{"url":"file:///private","img_src":"https://example.com/bad.jpg"}]}`)
	}))
	defer server.Close()
	t.Setenv("AGENTNET_ACTIVITY_SEARCH_URL", server.URL)
	p := prepareActivityImage(context.Background(), activityRequest{Query: "校园里的绿萝"})
	if p.Status != 200 || len(p.Candidates) != 1 || len(p.Content) != 0 || p.Candidates[0].SourceURL != "https://example.com/plants" {
		t.Fatalf("selection lost: %+v", p)
	}
	// Search does not silently choose an unrelated stock image. A selected image
	// needs source attribution; private downloads fail before any bytes are stored.
	p = prepareActivityImage(context.Background(), activityRequest{URL: "https://example.com/x.jpg"})
	if p.Status != 400 {
		t.Fatal("missing source accepted")
	}
	p = prepareActivityImage(context.Background(), activityRequest{URL: "https://127.0.0.1/x.jpg", Data: []byte(`{"source_url":"https://example.com/page","title":"leaf"}`)})
	if p.Status != 422 || len(p.Content) != 0 {
		t.Fatal("private image accepted")
	}
	t.Setenv("AGENTNET_ACTIVITY_SEARCH_URL", "")
	p = prepareActivityImage(context.Background(), activityRequest{Query: "campus garden"})
	if p.Status != 503 || p.Problem == "" {
		t.Fatal("provider failure hidden as no results")
	}
}
