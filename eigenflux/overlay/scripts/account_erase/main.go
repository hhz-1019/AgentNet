// Operator-only maintenance; credentials are read from the existing service env.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"

	"eigenflux_server/api/consolev2"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	account := flag.Int64("account", 0, "exact public account number")
	agent := flag.Int64("unbound-agent", 0, "exact internal ID of an unowned Agent")
	confirm := flag.String("confirm", "", "repeat the target number to apply permanent deletion; omitted means preview")
	flag.Parse()
	target := *account
	if *agent > 0 {
		target = *agent
	}
	if target <= 0 || (*account > 0 && *agent > 0) {
		fail("select exactly one target")
	}
	if *confirm != "" && *confirm != strconv.FormatInt(target, 10) {
		fail("confirmation does not match target")
	}
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		fail("PG_DSN is required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		fail("database unavailable")
	}
	result, err := consolev2.EraseAccountMaintenance(context.Background(), db, *account, *agent, *confirm != "")
	if err != nil {
		fail("erasure did not complete: " + err.Error())
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}
func fail(s string) { fmt.Fprintln(os.Stderr, s); os.Exit(1) }
