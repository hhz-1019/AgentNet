// commission_backfill repopulates the disposable Commission search projection.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"elsewhere_server/kitex_gen/elsewhere/commission/commissionservice"
	"elsewhere_server/kitex_gen/elsewhere/order/orderservice"
	"elsewhere_server/pipeline/embedding"
	"elsewhere_server/pkg/commissionindex"
	"elsewhere_server/pkg/commissionsource"
	"elsewhere_server/pkg/config"
	"elsewhere_server/pkg/es"
	"elsewhere_server/pkg/rpcx"

	etcd "github.com/kitex-contrib/registry-etcd"
)

var errCommissionIndexDisabled = errors.New("commission backfill requires ENABLE_COMMISSION_INDEX=true")

func main() {
	cfg := config.Load()
	if err := validateConfiguration(cfg); err != nil {
		log.Fatal(err)
	}
	if err := es.InitES(cfg.EmbeddingDimensions); err != nil {
		log.Fatal(err)
	}
	resolver, err := etcd.NewEtcdResolver(splitEndpoints(cfg.EtcdAddr))
	if err != nil {
		log.Fatal(err)
	}
	commissionClient, err := commissionservice.NewClient(cfg.CommissionSourceService, rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatal(err)
	}
	orderClient, err := orderservice.NewClient(cfg.OrderSourceService, rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatal(err)
	}
	store := commissionindex.ESStore{Index: cfg.CommissionIndexName, Alias: cfg.CommissionIndexAlias, Dimensions: cfg.EmbeddingDimensions}
	if err := store.Ensure(context.Background()); err != nil {
		log.Fatal(err)
	}
	source := commissionsource.Adapter{Commission: commissionClient, Order: orderClient}
	embedder := embedding.NewClient(cfg.EmbeddingProvider, cfg.EmbeddingApiKey, cfg.EmbeddingBaseURL, cfg.EmbeddingModel, cfg.EmbeddingDimensions)
	target := store
	target.Alias = ""
	if err := backfill(context.Background(), source, target, embedder, cfg.CommissionBackfillPageSize); err != nil {
		log.Fatal(err)
	}
	if err := store.PromoteAlias(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func validateConfiguration(cfg *config.Config) error {
	if cfg == nil || !cfg.EnableCommissionIndex {
		return errCommissionIndexDisabled
	}
	return nil
}

type embedder interface {
	GetEmbedding(context.Context, string) ([]float32, error)
}

func backfill(ctx context.Context, source commissionindex.Source, store commissionindex.Store, embedder embedder, pageSize int) error {
	if pageSize <= 0 {
		pageSize = 100
	}
	var cursor int64
	for {
		snapshots, next, err := source.ListActiveIndexSnapshots(ctx, cursor, pageSize)
		if err != nil {
			return err
		}
		ids := make([]int64, 0, len(snapshots))
		for _, snapshot := range snapshots {
			ids = append(ids, snapshot.CommissionID)
		}
		stats, err := source.BatchGetStatistics(ctx, ids)
		if err != nil {
			return err
		}
		byID := make(map[int64]commissionindex.StatisticsSnapshot, len(stats))
		for _, stat := range stats {
			byID[stat.CommissionID] = stat
		}
		for _, snapshot := range snapshots {
			stat := byID[snapshot.CommissionID]
			embedding, err := embedder.GetEmbedding(ctx, commissionindex.EmbeddingInput(snapshot))
			if err != nil {
				return fmt.Errorf("embed Commission %d: %w", snapshot.CommissionID, err)
			}
			if err := store.Upsert(ctx, commissionindex.BuildDocument(snapshot, stat, embedding)); err != nil {
				return fmt.Errorf("index Commission %d: %w", snapshot.CommissionID, err)
			}
		}
		if next == 0 || next == cursor {
			return nil
		}
		cursor = next
	}
}
func splitEndpoints(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
