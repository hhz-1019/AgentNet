// Run manually by a deployment administrator; stdout contains one-time secrets.
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"

	"eigenflux_server/api/consolev2"
	"eigenflux_server/pkg/config"
	"eigenflux_server/pkg/idgen"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	if len(os.Args) != 2 || os.Args[1] != "create-operator" {
		log.Fatal("usage: managed-admin create-operator (capture stdout privately)")
	}
	cfg := config.Load()
	db, err := gorm.Open(postgres.Open(cfg.PgDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		log.Fatal("database connection failed")
	}
	gen, err := idgen.NewManagedGenerator(context.Background(), idgen.ManagedGeneratorConfig{
		Endpoints: strings.Split(cfg.EtcdAddr, ","), WorkerPrefix: cfg.IDWorkerPrefix,
		ServiceName: "managed-admin", InstanceID: cfg.IDInstanceID,
		LeaseTTLSecond: cfg.IDWorkerLeaseTTL, EpochMS: cfg.IDSnowflakeEpoch,
	})
	if err != nil {
		log.Fatal("ID generator unavailable")
	}
	defer gen.Close(context.Background())
	result, err := consolev2.ProvisionManagedOperator(context.Background(), db, gen, os.Getenv("CONSOLE_V2_OTP_PEPPER"))
	if err != nil {
		log.Fatal(err)
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		log.Fatal("credential output failed")
	}
}
