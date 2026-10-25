package main

import (
	"context"
	"log"
	"strings"

	"github.com/cloudwego/hertz/pkg/app/server"
	etcd "github.com/kitex-contrib/registry-etcd"

	"elsewhere_server/kitex_gen/elsewhere/auth/authservice"
	"elsewhere_server/kitex_gen/elsewhere/notification/notificationservice"
	"elsewhere_server/kitex_gen/elsewhere/pm/pmservice"
	"elsewhere_server/pkg/config"
	"elsewhere_server/pkg/db"
	"elsewhere_server/pkg/logger"
	"elsewhere_server/pkg/metrics"
	"elsewhere_server/pkg/mq"
	"elsewhere_server/pkg/rpcx"
	"elsewhere_server/pkg/telemetry"
	"elsewhere_server/ws/handler"
)

func main() {
	cfg := config.Load()
	logFlush := logger.Init("WSService", cfg.EffectiveLokiURL(), cfg.LogLevel)
	defer logFlush()

	shutdown, err := telemetry.Init("WSService", cfg.OtelExporterEndpoint, cfg.MonitorEnabled)
	if err != nil {
		log.Fatalf("failed to init telemetry: %v", err)
	}
	defer shutdown(context.Background())

	go metrics.StartMetricsServer(cfg.WSPort + 1000)

	// Redis (for Pub/Sub subscription).
	db.InitRedis(cfg.RedisAddr, cfg.RedisPassword)
	mq.Init(cfg.RedisAddr, cfg.RedisPassword)
	mq.SetDefaultStreamMaxLen(cfg.MqStreamMaxLen)

	// etcd resolver for RPC clients.
	etcdEndpoints := strings.Split(cfg.EtcdAddr, ",")
	trimmed := make([]string, 0, len(etcdEndpoints))
	for _, e := range etcdEndpoints {
		if s := strings.TrimSpace(e); s != "" {
			trimmed = append(trimmed, s)
		}
	}
	if len(trimmed) == 0 {
		trimmed = []string{"localhost:2379"}
	}

	resolver, err := etcd.NewEtcdResolver(trimmed)
	if err != nil {
		log.Fatalf("failed to create etcd resolver: %v", err)
	}

	authClient, err := authservice.NewClient("AuthService", rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatalf("failed to create auth client: %v", err)
	}

	pmClient, err := pmservice.NewClient("PMService", rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatalf("failed to create pm client: %v", err)
	}
	notificationClient, err := notificationservice.NewClient("NotificationService", rpcx.ClientOptions(resolver)...)
	if err != nil {
		log.Fatalf("failed to create notification client: %v", err)
	}

	// Hertz HTTP server with WS route.
	wsHandler := handler.New(authClient, pmClient, db.RDB, notificationClient)

	listenAddr := cfg.ListenAddr(cfg.WSPort)
	h := server.Default(server.WithHostPorts(listenAddr))
	h.GET("/ws/pm", wsHandler.Serve)
	h.GET("/api/v2/agent/events/ws", wsHandler.ServeAgentV2)

	logger.Default().Info("WS service started", "addr", listenAddr)
	h.Spin()
}
