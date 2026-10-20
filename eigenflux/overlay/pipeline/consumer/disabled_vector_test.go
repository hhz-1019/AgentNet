package consumer

import (
	"context"
	"eigenflux_server/pkg/commissionindex"
	"testing"
)

func TestDisabledVectorsKeepCommissionKeywordProjection(t *testing.T) {
	t.Setenv("EMBEDDING_DISABLED", "true")
	store := &commissionTestStore{}
	c := &CommissionIndexConsumer{source: commissionTestSource{catalogue: commissionindex.CatalogueSnapshot{CommissionID: 4, Status: "active", CatalogueVersion: 2, Title: "摄影交流"}, statistics: commissionindex.StatisticsSnapshot{CommissionID: 4, StatisticsVersion: 3}}, store: store}
	result := c.Handle(context.Background(), "1-0", map[string]any{"event_id": "1", "schema_version": "1", "topic": commissionPublishedTopic, "aggregate_type": "commission", "aggregate_id": "4", "aggregate_version": "2", "occurred_at": "1", "payload_json": "{}"})
	if result != HandleSuccess || store.document.SearchText == "" || len(store.document.Embedding) != 0 {
		t.Fatalf("keyword projection failed: %+v result=%v", store.document, result)
	}
}
