package consolev2

import (
	"context"
	"eigenflux_server/pkg/accountlifecycle"
	globaldb "eigenflux_server/pkg/db"
	"encoding/json"
	"fmt"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestAccountDeletionProjectionFence(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	db := socialFixtureDB(t, dsn)
	ctx := context.Background()
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	check(insertProvisionedAgent(db, 808001, "erase-index@identity.invalid", "索引测试", 1))
	check(db.Exec(`INSERT INTO social_work_posts(post_id,agent_id,state,revision,visibility,document,created_at,published_at) VALUES
 (808011,808001,'published',1,'public','{"title":"公开","body":"不复制正文","tags":["摄影"]}',1,1),
 (808012,808001,'published',1,'friends','{"title":"私密"}',1,1)`).Error)
	old := globaldb.DB
	globaldb.DB = db
	defer func() { globaldb.DB = old }()
	writes := 0
	write := func() error { writes++; return nil }
	check(accountlifecycle.WithAgent(ctx, 808001, write))
	indexed := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/items" || r.Header.Get("X-API-Key") != "fence-key" {
			t.Error("unexpected sync")
		}
		var items []map[string]any
		check(json.NewDecoder(r.Body).Decode(&items))
		if len(items) != 1 || items[0]["ItemId"] != "post:808011" || items[0]["Comment"] != "公开" {
			t.Error("private/stale catalog", items)
		}
		indexed += len(items)
		fmt.Fprint(w, "{}")
	}))
	defer remote.Close()
	t.Setenv("AGENTNET_GORSE_URL", remote.URL)
	t.Setenv("AGENTNET_GORSE_API_KEY", "fence-key")
	s := &Service{db: db}
	h := server.New()
	h.POST("/sync", s.syncRecommendationCatalog)
	sync := func(key string) int {
		body := `{"post_ids":["808011","808012","808013"]}`
		return ut.PerformRequest(h.Engine, "POST", "/sync", &ut.Body{Body: strings.NewReader(body), Len: len(body)}, ut.Header{Key: "X-API-Key", Value: key}).Code
	}
	if sync("wrong") != 403 || indexed != 0 {
		t.Fatal("unguarded bridge sync")
	}
	if sync("fence-key") != 200 || indexed != 1 {
		t.Fatal("public sync failed")
	}
	check(db.Exec("DELETE FROM agents WHERE agent_id=808001").Error)
	check(accountlifecycle.WithAgent(ctx, 808001, write))
	if writes != 1 {
		t.Fatal("late indexing recreated erased data")
	}
	if sync("fence-key") != 200 || indexed != 1 {
		t.Fatal("stale bridge page recreated deleted post")
	}
}

func TestAccountDeletionResumesBatches(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db}
	p := accountErasure{Posts: []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21}}
	raw, _ := json.Marshal(p)
	if err := db.Exec(`INSERT INTO account_deletion_jobs(job_id,owner_uid,payload,created_at) VALUES('batch-test','batch-test',?::jsonb,1)`, string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	seen := []int64{}
	for i := 0; i < 3; i++ {
		if err := s.processAccountDeletion(context.Background(), func(_ context.Context, b accountErasure) error {
			if len(b.Posts) > 10 {
				t.Fatal("unbounded batch")
			}
			seen = append(seen, b.Posts...)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		var n int64
		db.Raw(`SELECT count(*) FROM account_deletion_jobs WHERE job_id='batch-test'`).Scan(&n)
		if (i < 2 && n != 1) || (i == 2 && n != 0) {
			t.Fatal("released before all batches", i, n)
		}
	}
	if len(seen) != 21 || seen[0] != 1 || seen[20] != 21 {
		t.Fatal("progress not persisted", seen)
	}
}
