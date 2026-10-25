package main

import (
	"context"
	"log"
	"net"
	"strings"

	etcd "github.com/kitex-contrib/registry-etcd"

	"elsewhere_server/kitex_gen/elsewhere/profile/profileservice"
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
	logFlush := logger.Init("ProfileService", cfg.EffectiveLokiURL(), cfg.LogLevel)
	defer logFlush()

	shutdown, err := telemetry.Init("ProfileService", cfg.OtelExporterEndpoint, cfg.MonitorEnabled)
	if err != nil {
		log.Fatalf("failed to init telemetry: %v", err)
	}
	defer shutdown(context.Background())

	go metrics.StartMetricsServer(cfg.ProfileRPCPort + 1000)

	db.Init(cfg.PgDSN)

	etcdEndpoints := splitEtcdEndpoints(cfg.EtcdAddr)
	agentIDGen, err := idgen.NewManagedGenerator(context.Background(), idgen.ManagedGeneratorConfig{
		Endpoints:      etcdEndpoints,
		WorkerPrefix:   cfg.IDWorkerPrefix,
		ServiceName:    "profile-agent-id",
		InstanceID:     cfg.IDInstanceID,
		LeaseTTLSecond: cfg.IDWorkerLeaseTTL,
		EpochMS:        cfg.IDSnowflakeEpoch,
	})
	if err != nil {
		log.Fatalf("failed to init profile agent id generator: %v", err)
	}
	defer func() {
		_ = agentIDGen.Close(context.Background())
	}()
	log.Printf("profile agent id generator ready: worker_id=%d", agentIDGen.WorkerID())

	r, err := etcd.NewEtcdRegistry(etcdEndpoints)
	if err != nil {
		log.Fatalf("failed to create etcd registry: %v", err)
	}

	listenAddr := cfg.ListenAddr(cfg.ProfileRPCPort)
	addr, _ := net.ResolveTCPAddr("tcp", listenAddr)
	svr := profileservice.NewServer(
		&ProfileServiceImpl{agentIDGen: agentIDGen},
		rpcx.ServerOptions(addr, r, "ProfileService", metrics.KitexServerMW())...,
	)

	if err := svr.Run(); err != nil {
		log.Fatalf("profile service failed: %v", err)
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
