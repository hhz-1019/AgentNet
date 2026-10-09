package consolev2

import (
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

func TestUIDSingleAgentClaim(t *testing.T) {
	dsn := os.Getenv("AGENTNET_PHONE_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:phone:core")
	}
	db := socialFixtureDB(t, dsn)
	if err := db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('single-agent-owner',888000111,'unused','unused',1)`).Error; err != nil {
		t.Fatal(err)
	}
	claim := func(id int64) error {
		return db.Transaction(func(tx *gorm.DB) error {
			return claimUIDAgent(tx, id, "single-agent-owner", time.Now().UnixMilli())
		})
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var group sync.WaitGroup
	for _, id := range []int64{25, 26} {
		group.Add(1)
		go func(id int64) {
			defer group.Done()
			<-start
			results <- claim(id)
		}(id)
	}
	close(start)
	group.Wait()
	close(results)
	accepted, rejected := 0, 0
	for err := range results {
		switch {
		case err == nil:
			accepted++
		case errors.Is(err, errOwnerHasAgent):
			rejected++
		default:
			t.Fatal(err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("concurrent claims: accepted=%d rejected=%d", accepted, rejected)
	}
	var ids []int64
	if err := db.Raw(`SELECT agent_id FROM agent_owners WHERE owner_uid='single-agent-owner'`).Scan(&ids).Error; err != nil || len(ids) != 1 {
		t.Fatal("owner must have exactly one identity", ids, err)
	}
	if err := claim(ids[0]); err != nil {
		t.Fatal("reconnecting the same identity must be idempotent", err)
	}
	// An inactive identity still owns its history; it is not permission to make another.
	if err := db.Exec(`UPDATE agents SET identity_state='inactive' WHERE agent_id=?`, ids[0]).Error; err != nil {
		t.Fatal(err)
	}
	if err := claim(27); !errors.Is(err, errOwnerHasAgent) {
		t.Fatal("inactive identity allowed a second claim", err)
	}
}

func TestUIDPasswordBounds(t *testing.T) {
	for _, value := range []string{"", "12345678901"} {
		if validOwnerPassword(value) {
			t.Fatal("short password accepted")
		}
	}
	if !validOwnerPassword("123456789012") {
		t.Fatal("valid password rejected")
	}
	if validOwnerPassword(string(make([]byte, 73))) {
		t.Fatal("bcrypt truncation permitted")
	}
}
func TestUIDRecentAuth(t *testing.T) {
	now := time.Now().UnixMilli()
	c := app.NewContext(0)
	c.Set("console_auth_method", "handoff")
	c.Set("console_recent_auth_at", now)
	if requireRecentEmailAuth(c, now) {
		t.Fatal("runtime handoff counted as human authentication")
	}
	c.Set("console_auth_method", "uid_password")
	if !requireRecentEmailAuth(c, now) {
		t.Fatal("UID owner authentication rejected")
	}
	if requireRecentEmailAuth(c, now+int64(6*time.Minute/time.Millisecond)) {
		t.Fatal("stale authentication accepted")
	}
}

func TestUIDNumericLookup(t *testing.T) {
	for _, value := range []string{"u_legacy", "9999", "999999999999999999999", "", "-10000"} {
		if lookupOwnerNumber(value) != 0 {
			t.Fatal("invalid number or alias parsed", value)
		}
	}
	if lookupOwnerNumber("10000") != 10000 || lookupOwnerNumber("100000") != 100000 {
		t.Fatal("numeric lookup rejected")
	}
}
