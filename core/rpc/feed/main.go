package main

import (
	"context"
	"log"
	"net"
	"strings"

	etcd "github.com/kitex-contrib/registry-etcd"

	"elsewhere_server/kitex_gen/elsewhere/feed/feedservice"
	"elsewhere_server/kitex_gen/elsewhere/item/itemservice"
	"elsewhere_server/kitex_gen/elsewhere/sort/sortservice"
	"elsewhere_server/pkg/config"
	"elsewhere_server/pkg/db"
	"elsewhere_server/pkg/idgen"
	"elsewhere_server/pkg/logger"
	"elsewhere_server/pkg/metrics"
	"elsewhere_server/pkg/mq"
	"elsewhere_server/pkg/rpcx"
	"elsewhere_server/pkg/telemetry"
)

var (
	sortClient sortservice.Client
	itemClient itemservice.Client
)

func main() {
	cfg := config.Load()
	logFlush := logger.Init("FeedService", cfg.EffectiveLokiURL(), cfg.LogLevel)
	defer logFlush()

	shutdown, err := telemetry.Init("FeedService", cfg.OtelExporterEndpoint, cfg.MonitorEnabled)
	if err != nil {
		log.Fatalf("failed to init telemetry: %v", err)
	}
	defer shutdown(context.Background())

	go metrics.StartMetricsServer(cfg.FeedRPCPort + 1000)

	db.Init(cfg.PgDSN)
	db.InitRedis(cfg.RedisAddr, cfg.RedisPassword)
	mq.Init(cfg.RedisAddr, cfg.RedisPassword)
	mq.SetDefaultStreamMaxLen(cfg.MqStreamMaxLen)

	etcdEndpoints := splitEtcdEndpoints(cfg.EtcdAddr)
	impressionIDGen, err := idgen.NewManagedGenerator(context.Background(), idgen.ManagedGeneratorConfig{
		Endpoints:      etcdEndpoints,
		WorkerPrefix:   cfg.IDWorkerPrefix,
		ServiceName:    "feed-impression-id",
		InstanceID:     cfg.IDInstanceID,
		LeaseTTLSecond: cfg.IDWorkerLeaseTTL,
		EpochMS:        cfg.IDSnowflakeEpoch,
	})
	if err != nil {
		log.Fatalf("failed to init feed impression id generator: %v", err)
	}
	defer func() {
		_ = impressionIDGen.Close(context.Background())
	}()

	resolver, err := etcd.NewEtcdResolver(etcdEndpoints)
	if err != nil {
		log.Fatalf("failed to create etcd resolver: %v", err)
	}

	sortClient, err = sortservice.NewClient("SortService", rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatalf("failed to create sort client: %v", err)
	}

	itemClient, err = itemservice.NewClient("ItemService", rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatalf("failed to create item client: %v", err)
	}

	registry, err := etcd.NewEtcdRegistry(etcdEndpoints)
	if err != nil {
		log.Fatalf("failed to create etcd registry: %v", err)
	}

	listenAddr := cfg.ListenAddr(cfg.FeedRPCPort)
	addr, _ := net.ResolveTCPAddr("tcp", listenAddr)
	svr := feedservice.NewServer(
		NewFeedServiceImpl(cfg, impressionIDGen),
		rpcx.ServerOptions(addr, registry, "FeedService", metrics.KitexServerMW())...,
	)

	if err := svr.Run(); err != nil {
		log.Fatalf("feed service failed: %v", err)
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
