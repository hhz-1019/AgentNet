package server

import (
	"context"
	"github.com/emicklei/go-restful/v3"
	"github.com/gorse-io/gorse/storage/cache"
	"github.com/gorse-io/gorse/storage/data"
	"net/http/httptest"
	"testing"
)

type elsewhereItemData struct {
	data.Database
	existing []data.Item
	written  []data.Item
}

func (d *elsewhereItemData) BatchGetItems(context.Context, []string, data.GetOptions) ([]data.Item, error) {
	return d.existing, nil
}
func (d *elsewhereItemData) BatchInsertItems(_ context.Context, items []data.Item) error {
	d.written = items
	return nil
}

type elsewhereItemCache struct {
	cache.Database
	updates, modifications int
}

func (c *elsewhereItemCache) UpdateScores(context.Context, []string, *string, string, cache.ScorePatch) error {
	c.updates++
	return nil
}
func (c *elsewhereItemCache) Set(_ context.Context, values ...cache.Value) error {
	c.modifications += len(values)
	return nil
}

func TestElsewhereItemCacheMetadata(t *testing.T) {
	for _, tc := range []struct {
		name    string
		old     []data.Item
		item    Item
		updates int
	}{
		{"text-only", []data.Item{{ItemId: "1", Comment: "old"}}, Item{ItemId: "1", Comment: "complete updated body", Labels: map[string]any{"content_revision": 2}}, 0},
		{"hidden", []data.Item{{ItemId: "1"}}, Item{ItemId: "1", IsHidden: true}, 1},
		{"category", []data.Item{{ItemId: "1"}}, Item{ItemId: "1", Categories: []string{"new"}}, 1},
		{"new", nil, Item{ItemId: "1"}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := &elsewhereItemData{existing: tc.old}
			c := &elsewhereItemCache{}
			s := &RestServer{DataClient: d, CacheClient: c}
			recorder := httptest.NewRecorder()
			s.batchInsertItems(context.Background(), restful.NewResponse(recorder), []Item{tc.item})
			if recorder.Code != 200 {
				t.Fatalf("HTTP %d", recorder.Code)
			}
			if c.updates != tc.updates {
				t.Fatalf("cache rewrites=%d expected=%d", c.updates, tc.updates)
			}
			if len(d.written) != 1 || d.written[0].Comment != tc.item.Comment || c.modifications != 1 {
				t.Fatal("item update or ranking invalidation lost")
			}
		})
	}
}
