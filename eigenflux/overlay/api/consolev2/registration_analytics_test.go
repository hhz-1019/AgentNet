package consolev2

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"os"
	"testing"
	"time"
)

func TestAnalyticsRegistration(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	exec := func(sql string, args ...any) { t.Helper(); check(db.Exec(sql, args...).Error) }
	ms := time.Now().UnixMilli()
	for i := int64(1); i <= 7; i++ {
		check(insertProvisionedAgent(db, 91000+i, fmt.Sprintf("reg%d@test.invalid", i), fmt.Sprintf("Registration %d", i), ms))
		exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,active_context_revision,created_at,updated_at) VALUES(?,'in_progress',1,1,1,?,?)`, 91000+i, ms, ms)
	}
	for i, owner := range []string{"registration-admin", "registration-user", "registration-ai", "registration-pending"} {
		exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,?,'test','test',?)`, owner, 23001+i, ms-3600000)
	}
	exec(`INSERT INTO agent_owners VALUES(91001,'registration-admin',?),(91004,'registration-user',?),(91006,'registration-ai',?),(91007,'registration-pending',?)`, ms, ms, ms, ms)
	exec(`INSERT INTO managed_campaigns(sponsor_uid) VALUES('registration-admin')`)
	exec(`INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona) VALUES(91006,'registration-ai','registration-admin',0,'AI','test','test')`)
	s := &Service{db: db, otpPepper: "registration-test", publicURL: "https://test.invalid"}
	record := func(id int64, event string) {
		t.Helper()
		c := app.NewContext(0)
		c.Set("agent_id", id)
		if !s.recordRegistration(c, event, "", "") {
			t.Fatal("tracking failed", event)
		}
	}
	record(91002, "form")
	record(91002, "password")
	record(91002, "form")
	exec(`UPDATE analytics_registration_journeys SET started_at=?,last_seen_at=? WHERE agent_id=91002`, ms-7200000, ms-7200000)
	record(91003, "sms")
	record(91003, "submit")
	c := app.NewContext(0)
	c.Set("agent_id", int64(91003))
	fail(c, 400, "PHONE_CODE_INVALID", "private form value must not be stored", nil)
	s.registrationOutcome(c, "register")
	record(91004, "profile")
	exec(`UPDATE analytics_registration_journeys SET source='observed',started_at=? WHERE agent_id=91004`, ms-7200000)
	exec(`UPDATE agent_onboarding_v2 SET state='completed',completed_at=? WHERE agent_id IN(91001,91004)`, ms)
	exec(`INSERT INTO analytics_registration_journeys(agent_id,source,started_at,last_input) VALUES(91005,'legacy',?,'unknown'),(91006,'legacy',?,'unknown'),(91007,'legacy',?,'unknown')`, ms-900000000, ms, ms)
	record(91006, "form") // A managed Agent cannot create or refresh registration telemetry.
	data, err := registrationSnapshot(db, time.Now(), 7, 30, 1, "all", "")
	check(err)
	summary := data["summary"].(map[string]any)
	for key, value := range map[string]float64{"started": 3, "completed": 1, "dormant": 1, "active": 1, "legacy_pending": 2} {
		if summary[key] != value {
			t.Fatalf("%s: %v", key, summary)
		}
	}
	if data["total"] != float64(5) {
		t.Fatal(data)
	}
	funnel := data["funnel"].([]any)
	for i, want := range []float64{3, 2, 2, 1, 1, 1} {
		if funnel[i].(map[string]any)["reached"] != want {
			t.Fatal("funnel", funnel)
		}
	}
	if funnel[0].(map[string]any)["stalled"] != float64(1) {
		t.Fatal("stalled stage", funnel)
	}
	longer, err := registrationSnapshot(db, time.Now(), 7, 1440, 1, "all", "")
	check(err)
	if longer["summary"].(map[string]any)["dormant"] != float64(0) {
		t.Fatal("idle threshold")
	}
	filtered, err := registrationSnapshot(db, time.Now(), 7, 30, 1, "dormant", "91002")
	check(err)
	if filtered["total"] != float64(1) {
		t.Fatal("filter")
	}
	literal, err := registrationSnapshot(db, time.Now(), 7, 30, 1, "all", "%")
	check(err)
	if literal["total"] != float64(0) {
		t.Fatal("wildcard search")
	}
	var secretValues int64
	check(db.Raw(`SELECT count(*) FROM analytics_registration_journeys WHERE error_code LIKE '%private%' OR last_input LIKE '%private%'`).Scan(&secretValues).Error)
	if secretValues != 0 {
		t.Fatal("form value persisted")
	}
	var recordedCode string
	check(db.Raw(`SELECT error_code FROM analytics_registration_journeys WHERE agent_id=91003`).Scan(&recordedCode).Error)
	if recordedCode != "PHONE_CODE_INVALID" {
		t.Fatal("missing authoritative failure code")
	}
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "23001")
	admin, err := s.newUIDSession(db, app.NewContext(0), "registration-admin", 91001, ms)
	check(err)
	pending, err := s.newUIDSession(db, app.NewContext(0), "registration-pending", 91007, ms)
	check(err)
	h := server.New()
	h.GET("/registration", s.consoleAuth(false), s.getRegistrationAnalytics)
	h.POST("/progress", s.consoleAuth(true), s.registrationProgress)
	call := func(method, path, body string, ss *uidSession, csrf bool, want int) {
		t.Helper()
		headers := []ut.Header{{Key: "Host", Value: "test.invalid"}, {Key: "Origin", Value: "https://test.invalid"}, {Key: "Content-Type", Value: "application/json"}}
		if ss != nil {
			headers = append(headers, ut.Header{Key: "Cookie", Value: fmt.Sprintf("ef_console_v2=%s.%s", ss.ID, ss.Secret)})
			if csrf {
				headers = append(headers, ut.Header{Key: "X-CSRF-Token", Value: ss.CSRF})
			}
		}
		r := ut.PerformRequest(h.Engine, method, "https://test.invalid"+path, &ut.Body{Body: bytes.NewBufferString(body), Len: len(body)}, headers...).Result()
		if r.StatusCode() != want {
			t.Fatalf("%s: %d %s", path, r.StatusCode(), r.Body())
		}
	}
	call("GET", "/registration", "", nil, false, 401)
	call("GET", "/registration", "", &pending, false, 403)
	call("GET", "/registration", "", &admin, false, 200)
	call("GET", "/registration?days=100", "", &admin, false, 400)
	call("GET", "/registration?idle=1", "", &admin, false, 400)
	call("GET", "/registration?page=0", "", &admin, false, 400)
	call("POST", "/progress", `{"event":"phone"}`, &pending, false, 403)
	call("POST", "/progress", `{"event":"phone"}`, &pending, true, 200)
	call("POST", "/progress", `{"event":"sms"}`, &pending, true, 400)
	call("POST", "/progress", `{"event":"completed"}`, &pending, true, 400)
	call("POST", "/progress", `{"event":"phone","agent_id":"91002","password":"private"}`, &pending, true, 400)
	var row struct{ LastInput string }
	check(db.Raw(`SELECT last_input FROM analytics_registration_journeys WHERE agent_id=91007`).Scan(&row).Error)
	if row.LastInput != "phone" {
		t.Fatal("session identity not recorded")
	}
	record(91005, "form")
	var resumed struct {
		Source    string
		StartedAt int64
	}
	check(db.Raw(`SELECT source,started_at FROM analytics_registration_journeys WHERE agent_id=91005`).Scan(&resumed).Error)
	if resumed.Source != "observed" || resumed.StartedAt < ms {
		t.Fatal("unowned historical resume must start a newly observed cohort", resumed)
	}
	check(db.Raw(`SELECT source,started_at FROM analytics_registration_journeys WHERE agent_id=91007`).Scan(&resumed).Error)
	if resumed.Source != "legacy" {
		t.Fatal("already registered historical owner must remain outside the funnel")
	}
	raw, _ := json.Marshal(data)
	if bytes.Contains(raw, []byte("password_hash")) || bytes.Contains(raw, []byte("Registration 6")) {
		t.Fatal("private fields or AI exposed")
	}
}
