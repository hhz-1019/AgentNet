package consolev2

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/gorm"
)

func TestAccountConnectionRepeatAndOwnerLogin(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	t.Setenv("HUMAN_AUTH_MODE", "uid")
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UnixMilli()
	const id int64 = 990001
	check(insertProvisionedAgent(db, id, "connection@identity.invalid", "林间", now))
	var principal int64
	check(db.Raw(`INSERT INTO agent_principals(agent_id,key_type,key_fingerprint,public_key,status,created_at,last_seen_at) VALUES(?,'ed25519-v1','connection-test',?,'limited',?,?) RETURNING principal_id`, id, make([]byte, 32), now, now).Scan(&principal).Error)
	check(db.Exec(`INSERT INTO agent_onboarding_v2(agent_id,state,current_step,revision,created_at,updated_at) VALUES(?,'in_progress',2,1,?,?)`, id, now, now).Error)
	check(db.Exec(`INSERT INTO agent_onboarding_drafts(agent_id,revision,draft_data,field_provenance,actor_type,request_id,created_at) VALUES(?,1,'{}','{}','agent_prefill','connection-test',?)`, id, now).Error)
	s := &Service{db: db, otpPepper: "private-connection-test-only", publicURL: "https://test.invalid"}
	h := server.New()
	h.POST("/create", func(ctx context.Context, c *app.RequestContext) {
		s.createAccountConnection(ctx, c, id, principal, []string{"account_recovery_v1"})
	})
	h.POST("/open", s.exchangeHandoff)
	h.GET("/api/v2/console/session", s.consoleAuth(false), s.getConsoleSession)
	h.GET("/api/v2/console/portrait", s.consoleAuth(false), s.getPortrait)
	cookies := map[string]string{}
	request := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		b, _ := json.Marshal(body)
		pairs := []string{}
		for k, v := range cookies {
			pairs = append(pairs, k+"="+v)
		}
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: strings.NewReader(string(b)), Len: len(b)}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Cookie", Value: strings.Join(pairs, "; ")}).Result()
		for _, raw := range r.Header.PeekAll("Set-Cookie") {
			pair := strings.SplitN(string(raw), ";", 2)[0]
			parts := strings.SplitN(pair, "=", 2)
			if len(parts) == 2 {
				cookies[parts[0]] = parts[1]
			}
		}
		var out map[string]any
		check(json.Unmarshal(r.Body(), &out))
		return r.StatusCode(), out
	}
	status, out := request("POST", "/create", nil)
	if status != 200 {
		t.Fatal(out)
	}
	first := out["data"].(map[string]any)["handoff_url"].(string)
	status, out = request("POST", "/create", nil)
	if status != 200 || out["data"].(map[string]any)["handoff_url"] != first {
		t.Fatal("registration page changed between requests", out)
	}
	u, err := url.Parse(first)
	check(err)
	fragment, err := url.ParseQuery(u.Fragment)
	check(err)
	if u.Path != "/dashboard/register" || u.Query().Get("ticket") != "" {
		t.Fatal("one-time ticket remains", first)
	}
	key := fragment.Get("connect")
	status, out = request("POST", "/open", map[string]any{"ticket": key})
	if status != 200 {
		t.Fatal(out)
	}
	oldCookie := cookies[consoleCookieName]
	status, out = request("POST", "/open", map[string]any{"ticket": key})
	if status != 200 || cookies[consoleCookieName] != oldCookie {
		t.Fatal("reopening reset registration/SMS session", out)
	}
	status, out = request("POST", "/open", map[string]any{"ticket": accountConnectionPrefix + strings.Repeat("0", 64)})
	if status != 401 || cookies[consoleCookieName] != oldCookie {
		t.Fatal("invalid connection changed session", out)
	}
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,phone_hash,phone_last4,phone_verified_at,created_at) VALUES('connection-owner',777880011,'test','test','verified-test-phone','8000',?,?)`, now, now).Error)
	check(db.Exec(`INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(?,'connection-owner',?)`, id, now).Error)
	check(db.Exec(`INSERT INTO agent_context_revisions(agent_id,revision,compiled_context,generated_at) VALUES(?,1,'{}',?)`, id, now).Error)
	check(db.Exec(`UPDATE agent_onboarding_v2 SET state='completed',current_step=5,completed_at=1,active_context_revision=1 WHERE agent_id=?`, id).Error)
	status, out = request("GET", "/api/v2/console/session", nil)
	if status != 200 || out["data"].(map[string]any)["owner_bound"] != false {
		t.Fatal("completed Agent counted as owner login", out)
	}
	status, out = request("GET", "/api/v2/console/portrait", nil)
	if status != 403 {
		t.Fatal("runtime session read private owner portrait", out)
	}
	status, out = request("POST", "/open", map[string]any{"ticket": key})
	if status != 200 || out["data"].(map[string]any)["requires_login"] != true || cookies[consoleCookieName] != oldCookie {
		t.Fatal("registered connection bypassed login or changed session", out)
	}
	var ownerSession uidSession
	c := app.NewContext(0)
	check(db.Transaction(func(tx *gorm.DB) error {
		var e error
		ownerSession, e = s.newUIDSession(tx, c, "connection-owner", id, now)
		return e
	}))
	cookies[consoleSessionCookieName(ownerSession.Slot)] = ownerSession.ID + "." + ownerSession.Secret
	cookies[consoleCSRFCookieName(ownerSession.Slot)] = ownerSession.CSRF
	cookies[activeConsoleSlotCookieName] = "0"
	verifiedCookie := cookies[consoleCookieName]
	status, out = request("POST", "/open", map[string]any{"ticket": key})
	if status != 200 || out["data"].(map[string]any)["requires_login"] != false || cookies[consoleCookieName] != verifiedCookie {
		t.Fatal("registration page downgraded verified login", out)
	}
	status, out = request("GET", "/api/v2/console/session", nil)
	if status != 200 || out["data"].(map[string]any)["owner_bound"] != true {
		t.Fatal("verified owner lost access", out)
	}
	status, out = request("POST", "/create", nil)
	if status != 200 || !strings.HasSuffix(out["data"].(map[string]any)["handoff_url"].(string), "/dashboard?account=777880011") {
		t.Fatal("existing owner still receives registration link", out)
	}
	check(db.Exec(`UPDATE agent_principals SET status='revoked',revoked_at=? WHERE principal_id=?`, now, principal).Error)
	status, out = request("POST", "/open", map[string]any{"ticket": key})
	if status != 401 {
		t.Fatal("revoked runtime connection remains usable", out)
	}
}
