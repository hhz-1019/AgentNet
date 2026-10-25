package main

import (
	"context"
	"log"
	"net"
	"strings"

	etcd "github.com/kitex-contrib/registry-etcd"

	"elsewhere_server/kitex_gen/elsewhere/item/itemservice"
	"elsewhere_server/pkg/config"
	"elsewhere_server/pkg/db"
	"elsewhere_server/pkg/idgen"
	"elsewhere_server/pkg/logger"
	"elsewhere_server/pkg/metrics"
	"elsewhere_server/pkg/rpcx"
	"elsewhere_server/pkg/telemetry"
)

func main() {
	cfg := config.Load()
	logFlush := logger.Init("ItemService", cfg.EffectiveLokiURL(), cfg.LogLevel)
	defer logFlush()

	shutdown, err := telemetry.Init("ItemService", cfg.OtelExporterEndpoint, cfg.MonitorEnabled)
	if err != nil {
		log.Fatalf("failed to init telemetry: %v", err)
	}
	defer shutdown(context.Background())

	go metrics.StartMetricsServer(cfg.ItemRPCPort + 1000)

	db.Init(cfg.PgDSN)

	etcdEndpoints := splitEtcdEndpoints(cfg.EtcdAddr)
	itemIDGen, err := idgen.NewManagedGenerator(context.Background(), idgen.ManagedGeneratorConfig{
		Endpoints:      etcdEndpoints,
		WorkerPrefix:   cfg.IDWorkerPrefix,
		ServiceName:    "item-item-id",
		InstanceID:     cfg.IDInstanceID,
		LeaseTTLSecond: cfg.IDWorkerLeaseTTL,
		EpochMS:        cfg.IDSnowflakeEpoch,
	})
	if err != nil {
		log.Fatalf("failed to init item id generator: %v", err)
	}
	defer func() {
		_ = itemIDGen.Close(context.Background())
	}()
	log.Printf("item id generator ready: worker_id=%d", itemIDGen.WorkerID())

	r, err := etcd.NewEtcdRegistry(etcdEndpoints)
	if err != nil {
		log.Fatalf("failed to create etcd registry: %v", err)
	}

	listenAddr := cfg.ListenAddr(cfg.ItemRPCPort)
	addr, _ := net.ResolveTCPAddr("tcp", listenAddr)
	svr := itemservice.NewServer(
		&ItemServiceImpl{itemIDGen: itemIDGen},
		rpcx.ServerOptions(addr, r, "ItemService", metrics.KitexServerMW())...,
	)

	if err := svr.Run(); err != nil {
		log.Fatalf("item service failed: %v", err)
	}
}

func splitEtcdEndpoints(raw string) []string {
	parts := strings.Split(raw, ",")
	endpoints := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			endpoints = append(endpoints, p)
		}
	}
	if len(endpoints) == 0 {
		return []string{"localhost:2379"}
	}
	return endpoints
}
