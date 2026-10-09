package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"gorm.io/gorm"
)

type managedTestIDs struct {
	mu sync.Mutex
	id int64
}

func (g *managedTestIDs) NextID() (int64, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.id++
	return g.id, nil
}
func TestManagedCatalogAndCredentialBoundary(t *testing.T) {
	catalog := managedCatalog()
	if len(catalog) != 100 {
		t.Fatal(len(catalog))
	}
	names := map[string]bool{}
	scenes := map[string]int{}
	for _, p := range catalog {
		if names[p.Name] || !strings.Contains(p.Persona, "AI") {
			t.Fatal(p)
		}
		names[p.Name] = true
		scenes[p.Scenario]++
	}
	if len(scenes) != 10 {
		t.Fatal(scenes)
	}
	for _, n := range scenes {
		if n != 10 {
			t.Fatal(scenes)
		}
	}
	numbers := map[int64]bool{}
	for _, n := range managedNumbers() {
		if numbers[n] || n < 10000 || n > 99999 {
			t.Fatal(n)
		}
		numbers[n] = true
	}
	if len(numbers) < 150 || !numbers[66666] || !numbers[12345] || !numbers[10000] {
		t.Fatal(numbers)
	}
	for _, text := range []string{`{"password":"secret-value"}`, `{"nested":{"api_key":"private-api-value"}}`, `Bearer abcdefghijklmnop`, `验证码：123456`, `token=abcdefghijklmnop`} {
		if !socialSecretPattern.MatchString(text) {
			t.Fatal("credential missed", text)
		}
	}
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "10001, 10002")
	if !managedAdminNumber("10002") || managedAdminNumber("100") || managedAdminNumber("") {
		t.Fatal("allowlist bypass")
	}
	if managedCost(50000, 1500, 100, 200) != 6 {
		t.Fatal("round reservation up")
	}
	for _, value := range []string{`C:\Users\owner\private.txt`, `/home/owner/private.txt`, `13800138000`} {
		if !managedPrivatePattern.MatchString(value) {
			t.Fatal("private data missed", value)
		}
	}
}

func TestManagedFullSchema(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated DB required")
	}
	db := socialFixtureDB(t, dsn)
	s := &Service{db: db, idgen: &managedTestIDs{id: 900000}, otpPepper: "managed-isolated-test", publicURL: "https://test.invalid"}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UnixMilli()
	check(insertProvisionedAgent(db, 1, "admin@identity.invalid", "运营测试", now))
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('operator',10001,'!test','!test',?),('other',10002,'!test','!test',?),('occupied',66666,'!test','!test',?)`, now, now, now).Error)
	check(db.Exec(`INSERT INTO agent_owners(agent_id,owner_uid,created_at) VALUES(1,'operator',?)`, now).Error)
	check(db.Exec(`INSERT INTO owner_uid_numbers(number,source,created_at) VALUES(88888,'operator',?)`, now).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "10001")
	t.Setenv("AGENTNET_MANAGED_WORKER", "false")
	ids, err := s.provisionManaged(context.Background(), "operator")
	check(err)
	if len(ids) != 100 {
		t.Fatal(len(ids))
	}
	again, err := s.provisionManaged(context.Background(), "operator")
	check(err)
	if len(again) != 0 {
		t.Fatal("seed not idempotent")
	}
	var count int64
	check(db.Raw(`SELECT count(*) FROM managed_members m JOIN agent_owners o USING(agent_id) JOIN agent_onboarding_v2 b USING(agent_id) JOIN agents a USING(agent_id) JOIN human_accounts h ON h.uid=m.owner_uid WHERE m.sponsor_uid='operator' AND o.owner_uid=m.owner_uid AND b.state='completed' AND a.is_official AND h.account_number BETWEEN 10000 AND 99999`).Scan(&count).Error)
	if count != 100 {
		t.Fatal("identities incomplete", count)
	}
	var occupied string
	check(db.Raw(`SELECT uid FROM human_accounts WHERE account_number=66666`).Scan(&occupied).Error)
	if occupied != "occupied" {
		t.Fatal("existing number stolen")
	}
	check(db.Raw(`SELECT count(*) FROM owner_uid_numbers WHERE number=88888 AND owner_uid IS NULL`).Scan(&count).Error)
	if count != 1 {
		t.Fatal("operator reservation stolen")
	}
	check(db.Raw(`SELECT count(*) FROM managed_members m JOIN owner_uid_numbers n ON n.owner_uid=m.owner_uid WHERE n.source='operator' AND n.registered AND n.reserved_agent_id=m.agent_id`).Scan(&count).Error)
	if count != 100 {
		t.Fatal("managed accounts missing from permanent UID ledger")
	}
	check(db.Raw(`SELECT issued FROM owner_uid_batches WHERE name='founding-5'`).Scan(&count).Error)
	if count != 0 {
		t.Fatal("managed accounts consumed public registration quota")
	}
	c := app.NewContext(0)
	c.Set("agent_id", int64(1))
	var session uidSession
	check(db.Transaction(func(tx *gorm.DB) error {
		var err error
		session, err = s.newUIDSession(tx, c, "operator", 1, now)
		return err
	}))
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) {
		c.Set("console_session_id", c.Request.Header.Get("X-Test-Session"))
		c.Set("agent_id", int64(1))
		c.Next(ctx)
	}
	h.GET("/managed", inject, s.getManaged)
	h.POST("/login/:member_id", inject, s.loginManaged)
	h.PUT("/edit/:member_id", inject, s.putManagedMember)
	h.POST("/batch", inject, s.batchManaged)
	call := func(method, path string, body any, sessionID string, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: bytes.NewReader(raw), Len: len(raw)}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "X-Test-Session", Value: sessionID}).Result()
		if r.StatusCode() != want {
			t.Fatalf("%s %s: %d %s", method, path, r.StatusCode(), r.Body())
		}
		return r.Body()
	}
	call("GET", "/managed", nil, "invalid", 403)
	raw := call("GET", "/managed", nil, session.ID, 200)
	if strings.Contains(string(raw), "password_hash") || !strings.Contains(string(raw), "10001") {
		t.Fatal("bad admin response")
	}
	call("POST", "/batch", map[string]any{"ids": []string{fmtRun(ids[0]), "1"}, "enabled": true}, session.ID, 403)
	check(db.Raw(`SELECT count(*) FROM managed_members WHERE enabled`).Scan(&count).Error)
	if count != 0 {
		t.Fatal("cross-owner batch changed members")
	}
	call("POST", "/login/1", map[string]any{}, session.ID, 403)
	loginResponse := ut.PerformRequest(h.Engine, "POST", "/login/"+fmtRun(ids[0]), &ut.Body{Body: strings.NewReader(`{}`), Len: 2}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "X-Test-Session", Value: session.ID}).Result()
	if loginResponse.StatusCode() != 200 {
		t.Fatal("login failed", loginResponse.StatusCode())
	}
	cookieResponse := &http.Response{Header: http.Header{}}
	loginResponse.Header.VisitAllCookie(func(_, value []byte) {
		cookieResponse.Header.Add("Set-Cookie", string(value))
	})
	cookies := []string{}
	csrf := ""
	for _, cookie := range cookieResponse.Cookies() {
		cookies = append(cookies, cookie.Name+"="+cookie.Value)
		if strings.HasPrefix(cookie.Name, "ef_console_v2_csrf") {
			csrf = cookie.Value
		}
	}
	if len(cookies) == 0 || csrf == "" {
		t.Fatal("browser session cookies missing")
	}
	actual := server.New()
	actual.GET("/posts", s.consoleAuth(false), s.requireCompleted, s.listSocialPosts)
	actual.POST("/drafts", s.consoleAuth(true), s.requireCompleted, s.createSocialDraft)
	cookieHeader := ut.Header{Key: "Cookie", Value: strings.Join(cookies, "; ")}
	hostHeader := ut.Header{Key: "Host", Value: "test.invalid"}
	if r := ut.PerformRequest(actual.Engine, "GET", "/posts", nil, cookieHeader).Result(); r.StatusCode() != 200 {
		t.Fatal("real browser session rejected", r.StatusCode(), string(r.Body()))
	}
	manualDoc := socialTestDocument()
	manualDoc.Title = "托管浏览器会话的手动草稿"
	manualRaw, _ := json.Marshal(socialWriteRequest{Document: manualDoc, Visibility: "public", IdempotencyKey: "manual-managed-test"})
	if r := ut.PerformRequest(actual.Engine, "POST", "https://test.invalid/drafts", &ut.Body{Body: bytes.NewReader(manualRaw), Len: len(manualRaw)}, cookieHeader, hostHeader, ut.Header{Key: "Origin", Value: "https://test.invalid"}).Result(); r.StatusCode() != 403 || !strings.Contains(string(r.Body()), "CSRF") {
		t.Fatal("CSRF bypass", r.StatusCode(), string(r.Body()))
	}
	if r := ut.PerformRequest(actual.Engine, "POST", "https://test.invalid/drafts", &ut.Body{Body: bytes.NewReader(manualRaw), Len: len(manualRaw)}, cookieHeader, hostHeader, ut.Header{Key: "Origin", Value: "https://test.invalid"}, ut.Header{Key: "X-CSRF-Token", Value: csrf}, ut.Header{Key: "Content-Type", Value: "application/json"}).Result(); r.StatusCode() != 201 {
		t.Fatal("manual draft failed", r.StatusCode(), string(r.Body()))
	}
	edit := managedMemberEdit{Name: "林知远", Scenario: "校园交友", Persona: managedCatalog()[0].Persona, DailyLimit: 2, StartHour: 9, EndHour: 22, Revision: 1}
	call("PUT", "/edit/"+fmtRun(ids[0]), edit, session.ID, 200)
	call("PUT", "/edit/"+fmtRun(ids[0]), edit, session.ID, 409)
	var publicBio string
	check(db.Raw(`SELECT bio FROM agents WHERE agent_id=?`, ids[0]).Scan(&publicBio).Error)
	if !strings.Contains(publicBio, edit.Name) || !strings.Contains(publicBio, "官方 AI") || strings.Contains(publicBio, edit.Persona) {
		t.Fatal("public profile did not update or exposed internal persona")
	}
	unsafeEdit := edit
	unsafeEdit.Revision = 2
	unsafeEdit.Scenario = "token=private-test-value"
	call("PUT", "/edit/"+fmtRun(ids[0]), unsafeEdit, session.ID, 400)
	var delegated string
	check(db.Raw(`SELECT session_id FROM managed_delegations WHERE sponsor_uid='operator' LIMIT 1`).Scan(&delegated).Error)
	call("GET", "/managed", nil, delegated, 200)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "")
	call("GET", "/managed", nil, delegated, 403)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "10001")
	check(db.Exec(`UPDATE managed_members SET enabled=true,start_hour=0,end_hour=24,next_run_at=0,daily_limit=2`).Error)
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true,monthly_budget_fen=6,input_fen_per_million=100,output_fen_per_million=200`).Error)
	job, err := s.claimManaged(context.Background(), time.Now())
	check(err)
	if job == nil {
		t.Fatal("nothing claimed")
	}
	other, err := s.claimManaged(context.Background(), time.Now())
	check(err)
	if other != nil {
		t.Fatal("budget overspent")
	}
	d := socialTestDocument()
	d.Kind = "question"
	value := managedModelResult{Value: managedOutput{Action: "post", Document: d}, Input: 500, Output: 100}
	check(s.commitManaged(context.Background(), *job, value, nil))
	if s.commitManaged(context.Background(), *job, value, nil) == nil {
		t.Fatal("duplicate commit accepted")
	}
	check(db.Raw(`SELECT count(*) FROM social_work_posts WHERE agent_id=? AND document->>'identity'='agent' AND document->>'body' LIKE '【官方 AI%'`, job.AgentID).Scan(&count).Error)
	if count != 1 {
		t.Fatal("post/label missing")
	}
	next, err := s.claimManaged(context.Background(), time.Now())
	check(err)
	if next != nil {
		t.Fatal("reservation exceeded remaining budget")
	}
	check(db.Exec(`UPDATE managed_campaigns SET monthly_budget_fen=100`).Error)
	next, err = s.claimManaged(context.Background(), time.Now())
	check(err)
	if next == nil {
		t.Fatal("new budget unavailable")
	}
	check(db.Exec(`UPDATE managed_campaigns SET enabled=false`).Error)
	check(s.commitManaged(context.Background(), *next, value, nil))
	var state string
	check(db.Raw(`SELECT status FROM managed_runs WHERE run_id=?`, next.RunID).Scan(&state).Error)
	if state != "skipped" {
		t.Fatal("paused job published")
	}
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true`).Error)
	next, err = s.claimManaged(context.Background(), time.Now())
	check(err)
	if next == nil {
		t.Fatal("claim missing")
	}
	bad := value
	bad.Value = managedOutput{Action: "comment", PostID: "1", Content: "这是一条不应该发送到其他用户帖子的评论。"}
	if s.commitManaged(context.Background(), *next, bad, map[int64]bool{}) == nil {
		t.Fatal("comment escaped supplied scope")
	}
	s.finishManagedFailure(*next)
	check(db.Raw(`SELECT charged_fen FROM managed_runs WHERE run_id=?`, next.RunID).Scan(&count).Error)
	if count != next.Reserved {
		t.Fatal("unknown provider charge refunded")
	}
	next, err = s.claimManaged(context.Background(), time.Now())
	check(err)
	if next == nil {
		t.Fatal("comment claim missing")
	}
	var published int64
	check(db.Raw(`SELECT post_id FROM social_work_posts WHERE agent_id=? AND state='published' LIMIT 1`, job.AgentID).Scan(&published).Error)
	comment := value
	comment.Value = managedOutput{Action: "comment", PostID: fmtRun(published), Content: "可以先把问题拆成两个小步骤，再对照一个具体的例子讨论，这样更容易看清分歧在哪里。"}
	check(db.Exec(`UPDATE social_work_posts SET visibility='private' WHERE post_id=?`, published).Error)
	if s.commitManaged(context.Background(), *next, comment, map[int64]bool{published: true}) == nil {
		t.Fatal("visibility change bypassed")
	}
	check(db.Exec(`UPDATE social_work_posts SET visibility='public' WHERE post_id=?`, published).Error)
	check(s.commitManaged(context.Background(), *next, comment, map[int64]bool{published: true}))
	check(db.Raw(`SELECT count(*) FROM social_work_comments WHERE agent_id=? AND content LIKE '【官方 AI】%'`, next.AgentID).Scan(&count).Error)
	if count != 1 {
		t.Fatal("comment not persisted")
	}
	next, err = s.claimManaged(context.Background(), time.Now())
	check(err)
	if next == nil {
		t.Fatal("revocation claim missing")
	}
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "")
	check(s.commitManaged(context.Background(), *next, value, nil))
	check(db.Raw(`SELECT status FROM managed_runs WHERE run_id=?`, next.RunID).Scan(&state).Error)
	if state != "skipped" {
		t.Fatal("revoked operator published")
	}
	// Real middleware rejects mutations without a session and CSRF proof.
	protected := server.New()
	protected.POST("/pause", s.consoleAuth(true), s.pauseManaged)
	r := ut.PerformRequest(protected.Engine, "POST", "/pause", nil).Result()
	if r.StatusCode() < 400 {
		t.Fatal("unauthenticated mutation accepted")
	}
	operator, err := ProvisionManagedOperator(context.Background(), db, s.idgen, s.otpPepper)
	check(err)
	account, err := s.authenticateUID(uidRequest{UID: operator["uid"], Password: operator["password"]})
	check(err)
	if account.UID != "managed_operator_v1" || account.RecoveryHash != keyedHash(s.otpPepper, operator["recovery_key"]) {
		t.Fatal("operator login/recovery failed")
	}
	if _, err = ProvisionManagedOperator(context.Background(), db, s.idgen, s.otpPepper); err == nil {
		t.Fatal("existing operator credentials replaced")
	}
	check(db.Raw(`SELECT count(*) FROM agent_onboarding_v2 WHERE agent_id=? AND state='completed'`, operator["agent_id"]).Scan(&count).Error)
	if count != 1 {
		t.Fatal("operator onboarding incomplete")
	}
}

type managedTransport func(*http.Request) (*http.Response, error)

func (f managedTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestManagedModelProtocol(t *testing.T) {
	t.Setenv("LLM_BASE_URL", "https://provider.test/v1")
	t.Setenv("LLM_MODEL", "fixture")
	t.Setenv("LLM_API_KEY", "test-key-do-not-output")
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(r.Body)
		if strings.Contains(string(b), "test-key-do-not-output") || r.Header.Get("Authorization") != "Bearer test-key-do-not-output" || !strings.Contains(string(b), `"max_tokens":1500`) {
			t.Fatal("bad credential or token contract")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"{\"action\":\"skip\"}"}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}`)), Header: http.Header{}}, nil
	})
	result, err := callManagedModel(context.Background(), map[string]string{"persona": "练习角色"})
	if err != nil || result.Value.Action != "skip" || result.Input != 100 {
		t.Fatal(result, err)
	}
	if _, err = callManagedModel(context.Background(), map[string]string{"api_key": "private-input"}); err == nil {
		t.Fatal("input secret reached model")
	}
	t.Setenv("LLM_BASE_URL", "http://insecure.test")
	if managedModelConfigured() {
		t.Fatal("insecure provider accepted")
	}
}
