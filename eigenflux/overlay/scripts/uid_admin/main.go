// Operator-only tool; PG_DSN comes from the service environment, never arguments.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"eigenflux_server/pkg/owneruid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	var cmd owneruid.Command
	flag.StringVar(&cmd.Action, "action", "status", "status, reserve, assign, open, pause or resume")
	flag.StringVar(&cmd.Name, "name", "", "batch name")
	flag.IntVar(&cmd.Digits, "digits", 0, "public batch digit length")
	flag.Int64Var(&cmd.Quota, "quota", 0, "public batch quota")
	flag.Int64Var(&cmd.Number, "uid", 0, "requested owner UID")
	flag.Int64Var(&cmd.AgentID, "agent", 0, "unowned Agent's internal ID for assignment")
	flag.StringVar(&cmd.Actor, "actor", "", "operator identity")
	flag.StringVar(&cmd.Reason, "reason", "", "authorization / purpose")
	flag.Parse()
	dsn := os.Getenv("PG_DSN")
	if dsn == "" {
		fail("PG_DSN is required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		fail("database connection failed")
	}
	if cmd.Action == "status" {
		var batches []owneruid.Batch
		if db.Raw(`SELECT * FROM owner_uid_batches ORDER BY digits,name`).Scan(&batches).Error != nil {
			fail("cannot read UID batches")
		}
		_ = json.NewEncoder(os.Stdout).Encode(batches)
		return
	}
	if err = owneruid.Admin(db, cmd); err != nil {
		fail(err.Error())
	}
	fmt.Println("UID administration completed; audit event recorded")
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
