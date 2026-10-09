package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/gorm"
)

func TestManagedElsewherePortraitConfirmation(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("full schema required")
	}
	db := socialFixtureDB(t, dsn)
	now := time.Now().UnixMilli()
	id := int64(777001)
	check := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	check(insertProvisionedAgent(db, id, "portrait-test@identity.invalid", "待确认", now))
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('portrait-confirm-owner',777001,'!test','!test',?)`, now).Error)
	check(db.Exec(`INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(?,'portrait-confirm-owner',?)`, id, now).Error)
	check(db.Exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,created_at,updated_at) VALUES(?,'in_progress',2,1,?,?)`, id, now, now).Error)
	check(db.Exec(`INSERT INTO agent_context_heads(agent_id,current_revision,active_revision,updated_at) VALUES(?,0,NULL,?)`, id, now).Error)
	s := &Service{db: db, idgen: &managedTestIDs{id: 777100}, otpPepper: "test-confirm", publicURL: "https://test.invalid"}
	c := app.NewContext(0)
	c.Set("agent_id", id)
	var session uidSession
	check(db.Transaction(func(tx *gorm.DB) error {
		var e error
		session, e = s.newUIDSession(tx, c, "portrait-confirm-owner", id, now)
		return e
	}))
	h := server.New()
	auth := func(ctx context.Context, c *app.RequestContext) {
		c.Set("agent_id", id)
		c.Set("console_session_id", session.ID)
		c.Next(ctx)
	}
	h.PUT("/api/v2/console/portrait", auth, s.putPortrait)
	h.POST("/confirm", auth, s.confirmPortrait)
	call := func(method, path string, body any, want int) {
		t.Helper()
		b, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(b)), Len: len(b)}, ut.Header{Key: "Content-Type", Value: "application/json"})
		if r.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, r.Code, r.Body.String())
		}
	}
	request := map[string]any{"expected_revision": 0, "fields": map[string]string{"name": "只有昵称，其他选填为空"}}
	call("PUT", "/api/v2/console/portrait", request, 200)
	call("PUT", "/api/v2/console/portrait", request, 200) // lost-response retry
	call("POST", "/confirm", map[string]any{"revision": 1, "agreed": false}, 400)
	call("POST", "/confirm", map[string]any{"revision": 0, "agreed": true}, 409)
	call("POST", "/confirm", map[string]any{"revision": 1, "agreed": true}, 200)
	call("POST", "/confirm", map[string]any{"revision": 1, "agreed": true}, 200)
	var state string
	check(db.Raw(`SELECT state FROM agent_onboarding_v2 WHERE agent_id=?`, id).Scan(&state).Error)
	if state != "completed" {
		t.Fatal(state)
	}
	var active int64
	check(db.Raw(`SELECT active_revision FROM agent_context_heads WHERE agent_id=?`, id).Scan(&active).Error)
	if active != 1 {
		t.Fatal("confirmation duplicated context activation", active)
	}
}
