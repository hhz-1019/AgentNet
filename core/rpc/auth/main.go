package main

import (
	"elsewhere_server/pkg/ownerauth"
	"context"
	"log"
	"net"
	"strings"

	etcd "github.com/kitex-contrib/registry-etcd"

	"elsewhere_server/kitex_gen/elsewhere/auth/authservice"
	"elsewhere_server/pkg/config"
	"elsewhere_server/pkg/db"
	"elsewhere_server/pkg/email"
	"elsewhere_server/pkg/idgen"
	"elsewhere_server/pkg/logger"
	"elsewhere_server/pkg/metrics"
	"elsewhere_server/pkg/mq"
	"elsewhere_server/pkg/rpcx"
	"elsewhere_server/pkg/telemetry"
)

// cfg is package-level for shared runtime config.
var cfg *config.Config

func main() {
	cfg = config.Load()
	logFlush := logger.Init("AuthService", cfg.EffectiveLokiURL(), cfg.LogLevel)
	defer logFlush()

	shutdown, err := telemetry.Init("AuthService", cfg.OtelExporterEndpoint, cfg.MonitorEnabled)
	if err != nil {
		log.Fatalf("failed to init telemetry: %v", err)
	}
	defer shutdown(context.Background())

	go metrics.StartMetricsServer(cfg.AuthRPCPort + 1000)

	db.Init(cfg.PgDSN)
	mq.Init(cfg.RedisAddr, cfg.RedisPassword)
	mq.SetDefaultStreamMaxLen(cfg.MqStreamMaxLen)

	etcdEndpoints := splitEtcdEndpoints(cfg.EtcdAddr)
	agentIDGen, err := idgen.NewManagedGenerator(context.Background(), idgen.ManagedGeneratorConfig{
		Endpoints:      etcdEndpoints,
		WorkerPrefix:   cfg.IDWorkerPrefix,
		ServiceName:    "auth-agent-id",
		InstanceID:     cfg.IDInstanceID,
		LeaseTTLSecond: cfg.IDWorkerLeaseTTL,
		EpochMS:        cfg.IDSnowflakeEpoch,
	})
	if err != nil {
		log.Fatalf("failed to init agent id generator: %v", err)
	}
	defer func() {
		_ = agentIDGen.Close(context.Background())
	}()
	log.Printf("auth agent id generator ready: worker_id=%d", agentIDGen.WorkerID())

	var emailSender email.Sender
	if ownerauth.UIDEnabled() {
		log.Printf("human accounts: UID; legacy email login disabled")
	} else if cfg.EnableEmailVerification {
		emailSender, err = email.NewConfiguredSender(cfg.ResendApiKey, cfg.ResendFromEmail)
		if err != nil {
			log.Fatalf("invalid email configuration: %v", err)
		}
		log.Printf("auth email sender configured (env=%s)", strings.ToLower(strings.TrimSpace(cfg.AppEnv)))
	} else {
		log.Printf("auth email verification disabled: login will issue sessions directly")
	}

	r, err := etcd.NewEtcdRegistry(etcdEndpoints)
	if err != nil {
		log.Fatalf("failed to create etcd registry: %v", err)
	}

	listenAddr := cfg.ListenAddr(cfg.AuthRPCPort)
	addr, _ := net.ResolveTCPAddr("tcp", listenAddr)
	svr := authservice.NewServer(
		&AuthServiceImpl{
			emailSender:              emailSender,
			emailVerificationEnabled: cfg.EnableEmailVerification,
			mockUniversalOTP:         strings.TrimSpace(cfg.MockUniversalOTP),
			mockOTPEmailSuffix:       cfg.MockOTPEmailSuffixes,
			mockOTPIPWhitelist:       cfg.MockOTPIPWhitelist,
			testEmailSuffixes:        cfg.OfficialTestEmailSuffixes,
			testOTP:                  strings.TrimSpace(cfg.OfficialTestOTP),
			agentIDGen:               agentIDGen,
		},
		rpcx.ServerOptions(addr, r, "AuthService", metrics.KitexServerMW())...,
	)

	if err := svr.Run(); err != nil {
		log.Fatalf("auth service failed: %v", err)
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
