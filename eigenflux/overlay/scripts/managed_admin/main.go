// Run manually by a deployment administrator; stdout contains one-time secrets.
package main

import (
	"context"
	"encoding/json"
	"io"
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
	if len(os.Args) != 2 || (os.Args[1] != "create-operator" && os.Args[1] != "register-recruiters" && os.Args[1] != "reconcile-celebrities") {
		log.Fatal("usage: managed-admin create-operator | reconcile-celebrities (AGENTNET_MANAGED_SPONSOR_UID required) | register-recruiters (catalog JSON on stdin; AGENTNET_RECRUITER_SPONSOR_UID required)")
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
	if os.Args[1] == "reconcile-celebrities" {
		created, err := consolev2.ReconcileManagedCelebrities(context.Background(), db, gen, os.Getenv("AGENTNET_MANAGED_SPONSOR_UID"))
		if err != nil {
			log.Fatal(err)
		}
		if err := json.NewEncoder(os.Stdout).Encode(map[string]int{"created": created}); err != nil {
			log.Fatal("result output failed")
		}
		return
	}
	if os.Args[1] == "register-recruiters" {
		var catalog consolev2.RecruiterCatalog
		if err := json.NewDecoder(io.LimitReader(os.Stdin, 128*1024)).Decode(&catalog); err != nil {
			log.Fatal("invalid recruitment catalog")
		}
		result, err := consolev2.ProvisionRecruiters(context.Background(), db, gen, os.Getenv("AGENTNET_RECRUITER_SPONSOR_UID"), catalog)
		if err != nil {
			log.Fatal(err)
		}
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			log.Fatal("result output failed")
		}
		return
	}
	result, err := consolev2.ProvisionManagedOperator(context.Background(), db, gen, os.Getenv("CONSOLE_V2_OTP_PEPPER"))
	if err != nil {
		log.Fatal(err)
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		log.Fatal("credential output failed")
	}
}
