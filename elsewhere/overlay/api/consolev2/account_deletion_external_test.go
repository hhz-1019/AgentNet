package consolev2

import (
	"context"
	"eigenflux_server/pkg/es"
	"fmt"
	"github.com/alicebob/miniredis/v2"
	"github.com/elastic/go-elasticsearch/v8"
	"github.com/redis/go-redis/v9"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAccountDeletionExternalStores(t *testing.T) {
	ctx := context.Background()
	r := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: r.Addr()})
	defer client.Close()
	p := accountErasure{Agents: []int64{807001}, Items: []int64{807041}, Posts: []int64{807011}, Keys: []string{"private:own"}}
	r.Set("private:own", "private")
	r.Set("private:peer", "retain")
	r.Set("cache:search:peer", "old author content")
	r.HSet("agentcard:last_active", "807001", "1", "807002", "1")
	_, err := client.XAdd(ctx, &redis.XAddArgs{Stream: "stream:item:publish", Values: map[string]any{"item_id": "807041"}}).Result()
	if err != nil {
		t.Fatal(err)
	}
	peer, err := client.XAdd(ctx, &redis.XAddArgs{Stream: "stream:item:publish", Values: map[string]any{"item_id": "807042"}}).Result()
	if err != nil {
		t.Fatal(err)
	}
	deletes := map[string]bool{}
	failIndex := true
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Elastic-Product", "Elasticsearch")
		if strings.Contains(req.URL.Path, "_delete_by_query") {
			if failIndex {
				w.WriteHeader(403)
				fmt.Fprint(w, `{"total":1,"deleted":0,"failures":[{}]}`)
				return
			}
			fmt.Fprint(w, `{"total":1,"deleted":1,"failures":[]}`)
			return
		}
		if req.Method != "DELETE" || req.Header.Get("X-API-Key") != "fixture-key" {
			t.Error("unexpected external erasure", req.Method, req.URL.Path)
		}
		deletes[req.URL.Path] = true
		w.WriteHeader(404)
	}))
	defer remote.Close()
	old := es.Client
	defer func() { es.Client = old }()
	es.Client, err = elasticsearch.NewClient(elasticsearch.Config{Addresses: []string{remote.URL}})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("AGENTNET_GORSE_URL", remote.URL)
	t.Setenv("AGENTNET_GORSE_API_KEY", "fixture-key")
	s := &Service{redisClient: client}
	if s.eraseAccountExternal(ctx, p) == nil {
		t.Fatal("index failure did not block completion")
	}
	failIndex = false
	if err = s.eraseAccountExternal(ctx, p); err != nil {
		t.Fatal(err)
	}
	if r.Exists("private:own") || r.Exists("cache:search:peer") || !r.Exists("private:peer") {
		t.Fatal("cache erasure boundary")
	}
	if r.HGet("agentcard:last_active", "807001") != "" || r.HGet("agentcard:last_active", "807002") != "1" {
		t.Fatal("shared hash boundary")
	}
	rows, err := client.XRange(ctx, "stream:item:publish", "-", "+").Result()
	if err != nil || len(rows) != 1 || rows[0].ID != peer {
		t.Fatal("queue boundary", rows, err)
	}
	if !deletes["/api/user/agent:807001"] || !deletes["/api/item/post:807011"] {
		t.Fatal("Gorse cleanup missing", deletes)
	}
	if err = s.eraseAccountExternal(ctx, p); err != nil {
		t.Fatal("retry not idempotent", err)
	}
	es.Client = nil
	t.Setenv("ES_URL", remote.URL)
	if err = s.eraseAccountExternal(ctx, p); err != nil {
		t.Fatal("normal API process without global ES initialization", err)
	}
}
