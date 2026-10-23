package consolev2

import (
	"errors"
	"os"
	"strconv"
	"sync"
	"testing"

	"eigenflux_server/pkg/owneruid"
	"gorm.io/gorm"
)

func TestUIDBatchRules(t *testing.T) {
	dsn := os.Getenv("AGENTNET_PHONE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	admin := func(action string, number, agent int64) error {
		return owneruid.Admin(tx, owneruid.Command{Action: action, Number: number, AgentID: agent, Actor: "test-operator", Reason: "isolated verification"})
	}
	var assigned int64
	must(tx.Raw(`SELECT n FROM generate_series(50000,59999) n WHERE NOT EXISTS(SELECT 1 FROM owner_uid_numbers WHERE number=n) LIMIT 1`).Scan(&assigned).Error)
	must(admin("reserve", assigned, 0))
	if admin("reserve", assigned, 0) == nil {
		t.Fatal("duplicate reservation allowed")
	}
	// Admin wraps errors in a savepoint: the outer transaction stays usable.
	must(admin("assign", assigned, 11))
	if admin("assign", assigned, 12) == nil {
		t.Fatal("reserved UID reassigned")
	}
	for _, number := range []int64{9999, 100000000000} {
		if admin("reserve", number, 0) == nil {
			t.Fatal("invalid UID accepted")
		}
	}
	must(admin("assign", 99999999999, 12))
	if admin("assign", 77777, 20) == nil {
		t.Fatal("owned Agent assigned another UID")
	}
	must(admin("pause", 0, 0))
	if _, err := owneruid.Allocate(tx, 13, 1); !errors.Is(err, owneruid.ErrClosed) {
		t.Fatal("paused batch issued", err)
	}
	// Operator assignment works during a pause and never consumes public quota.
	var before int64
	must(tx.Raw(`SELECT issued FROM owner_uid_batches WHERE name='founding-5'`).Scan(&before).Error)
	number, err := owneruid.Allocate(tx, 11, 1)
	must(err)
	if number != assigned {
		t.Fatal("assignment not honored", number)
	}
	uid := strconv.FormatInt(number, 10)
	must(tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'test','test',1)`, uid, number).Error)
	var after int64
	must(tx.Raw(`SELECT issued FROM owner_uid_batches WHERE name='founding-5'`).Scan(&after).Error)
	if before != after {
		t.Fatal("operator allocation consumed public quota")
	}
	// Already-issued numbers and private owner keys are immutable.
	if err := tx.Transaction(func(inner *gorm.DB) error {
		return inner.Exec(`UPDATE human_accounts SET account_number=99999 WHERE uid=?`, uid).Error
	}); err == nil {
		t.Fatal("issued UID changed")
	}
	must(tx.Exec(`DELETE FROM human_accounts WHERE uid=?`, uid).Error)
	if admin("reserve", number, 0) == nil {
		t.Fatal("deleted account UID recycled")
	}
	if err := tx.Transaction(func(inner *gorm.DB) error {
		return inner.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'test','test',1)`, uid, number).Error
	}); err == nil {
		t.Fatal("deleted owner recreated")
	}
	number, err = owneruid.Allocate(tx, 12, 1)
	must(err)
	if number != 99999999999 {
		t.Fatal("11-digit manual allocation failed")
	}
	// Open explicitly; malformed/duplicate opens do not close the current batch.
	open := owneruid.Command{Action: "open", Name: "test-six", Digits: 6, Quota: 1, Actor: "test", Reason: "manual switch"}
	must(owneruid.Admin(tx, open))
	if owneruid.Admin(tx, open) == nil {
		t.Fatal("batch name overwritten")
	}
	number, err = owneruid.Allocate(tx, 13, 1)
	must(err)
	if number < 100000 || number > 999999 {
		t.Fatal("wrong batch length")
	}
	if _, err = owneruid.Allocate(tx, 14, 1); !errors.Is(err, owneruid.ErrClosed) {
		t.Fatal("batch automatically advanced", err)
	}
	var active string
	must(tx.Raw(`SELECT name FROM owner_uid_batches WHERE active`).Scan(&active).Error)
	if active != "test-six" {
		t.Fatal("exhausted batch switched")
	}
	// Fully reserved five-digit pool must fail closed, never expand to six digits.
	open.Name = "test-full"
	open.Digits = 5
	open.Quota = 1
	must(owneruid.Admin(tx, open))
	var gap int64
	must(tx.Raw(`SELECT n FROM generate_series(88000,88999) n WHERE NOT EXISTS(SELECT 1 FROM owner_uid_numbers WHERE number=n) LIMIT 1`).Scan(&gap).Error)
	must(tx.Exec(`INSERT INTO owner_uid_numbers(number,source,created_at) SELECT n,'operator',1 FROM generate_series(10000,99999) n ON CONFLICT DO NOTHING`).Error)
	if _, err = owneruid.Allocate(tx, 14, 1); !errors.Is(err, owneruid.ErrClosed) {
		t.Fatal("full pool not closed", err)
	}
	// Exactly one gap: the bounded fallback must find it despite dense reservations.
	must(tx.Exec(`DELETE FROM owner_uid_numbers WHERE number=? AND owner_uid IS NULL`, gap).Error)
	number, err = owneruid.Allocate(tx, 14, 1)
	must(err)
	if number != gap {
		t.Fatal("last available number was missed", number)
	}
}

func TestUIDConcurrentLastSlots(t *testing.T) {
	dsn := os.Getenv("AGENTNET_PHONE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := socialFixtureDB(t, dsn)
	if err := owneruid.Admin(db, owneruid.Command{Action: "open", Name: "test-concurrent", Digits: 11, Quota: 3, Actor: "test", Reason: "concurrency verification"}); err != nil {
		t.Fatal(err)
	}
	defer func() {
		// Fixture cleanup only; real issuance history is never deleted.
		_ = db.Exec(`DELETE FROM human_accounts WHERE uid IN(SELECT owner_uid FROM owner_uid_numbers WHERE batch_name='test-concurrent'); DELETE FROM owner_uid_numbers WHERE batch_name='test-concurrent'; DELETE FROM owner_uid_batches WHERE name='test-concurrent'; UPDATE owner_uid_batches SET active=true WHERE name='founding-5'`).Error
	}()
	var wg sync.WaitGroup
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- db.Transaction(func(tx *gorm.DB) error {
				number, err := owneruid.Allocate(tx, 0, 1)
				if err != nil {
					return err
				}
				return tx.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'test','test',1)`, strconv.FormatInt(number, 10), number).Error
			})
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else if !errors.Is(err, owneruid.ErrClosed) {
			t.Fatal(err)
		}
	}
	var issued int64
	if err := db.Raw(`SELECT issued FROM owner_uid_batches WHERE name='test-concurrent'`).Scan(&issued).Error; err != nil {
		t.Fatal(err)
	}
	if successes != 3 || issued != 3 {
		t.Fatal("concurrent quota exceeded or under-issued", successes, issued)
	}
}
