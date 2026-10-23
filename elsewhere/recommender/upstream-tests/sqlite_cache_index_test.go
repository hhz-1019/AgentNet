package cache

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestElsewhereSQLiteItemIndex(t *testing.T) {
	db, err := Open("sqlite://"+filepath.ToSlash(filepath.Join(t.TempDir(), "cache.db")), "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Init(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = db.AddScores(ctx, Recommend, "synthetic-user", []Score{{Id: "post:1", Score: 0.8, Timestamp: time.Now()}}); err != nil {
		t.Fatal(err)
	}
	// Existing cache data survives repeat initialization and the index is reused.
	if err = db.Init(); err != nil {
		t.Fatal(err)
	}
	items, err := db.SearchScores(ctx, Recommend, "synthetic-user", nil, 0, 10)
	if err != nil || len(items) != 1 || items[0].Id != "post:1" {
		t.Fatalf("cache changed: %v %v", items, err)
	}
	sqlDB := db.(*SQLDatabase)
	rows, err := sqlDB.client.Query("EXPLAIN QUERY PLAN SELECT id FROM documents WHERE collection=? AND id=?", Recommend, "post:1")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	indexed := false
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		indexed = indexed || (strings.Contains(detail, "idx_collection_id") && strings.Contains(detail, "id=?"))
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !indexed {
		t.Fatal("item lookup scans every subset instead of using collection/id index")
	}
}
