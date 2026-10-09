package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"eigenflux_server/pkg/owneruid"

	"github.com/alicebob/miniredis/v2"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

type phoneFakeSender struct {
	mu    sync.Mutex
	codes map[string]string
	fail  bool
	sends int
}

func (f *phoneFakeSender) Send(_ context.Context, _ string, code, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sends++
	if f.fail {
		return errors.New("delivery failed")
	}
	f.codes[id] = code
	return nil
}
func (f *phoneFakeSender) code(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.codes[id]
}
func TestPhoneNormalize(t *testing.T) {
	for _, raw := range []string{"13800138000", " +8613800138000 "} {
		phone, ok := normalizePhone(raw)
		if !ok || phone != "13800138000" {
			t.Fatal("normalization failed")
		}
	}
	for _, raw := range []string{"+12125551234", "1380013800", "138001380000", "1e100000000", "12800138000"} {
		if _, ok := normalizePhone(raw); ok {
			t.Fatal("invalid phone accepted")
		}
	}
}
func TestPhoneQuotas(t *testing.T) {
	r := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: r.Addr()})
	defer client.Close()
	s := &Service{redisClient: client, otpPepper: "test", phoneDailyLimit: 2}
	c := app.NewContext(0)
	for i, phone := range []string{"13800138000", "13800138000", "13800138001", "13800138002"} {
		allowed, err := s.allowPhoneSend(context.Background(), c, phone)
		if err != nil {
			t.Fatal(err)
		}
		if allowed != (i == 0 || i == 2) {
			t.Fatal("cooldown or global cap bypass")
		}
	}
	r.FastForward(24 * time.Hour)
	if ok, err := s.allowPhoneSend(context.Background(), c, "13800138002"); !ok || err != nil {
		t.Fatal("quota did not expire")
	}
	s.redisClient = nil
	if ok, err := s.allowPhoneSend(context.Background(), c, "13800138003"); ok || err == nil {
		t.Fatal("Redis failure permitted paid send")
	}
}
func TestPhonePostgresRegistration(t *testing.T) {
	dsn := os.Getenv("AGENTNET_PHONE_TEST_DSN")
	if dsn == "" {
		t.Skip("run npm run test:phone:core")
	}
	db := socialFixtureDB(t, dsn)
	r := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: r.Addr()})
	defer client.Close()
	sender := &phoneFakeSender{codes: map[string]string{}}
	s := &Service{db: db, redisClient: client, otpPepper: "phone-test-pepper", phoneSender: sender, phoneDailyLimit: 1000}
	h := server.New()
	inject := func(ctx context.Context, c *app.RequestContext) {
		id, _ := strconv.ParseInt(string(c.GetHeader("Test-Agent")), 10, 64)
		c.Set("agent_id", id)
		session := string(c.GetHeader("Test-Session"))
		if session == "" {
			session = "browser-" + strconv.FormatInt(id, 10)
		}
		c.Set("console_session_id", session)
		c.Next(ctx)
	}
	h.POST("/send", inject, s.createPhoneChallenge)
	h.POST("/register", inject, s.registerUID)
	h.POST("/login", inject, s.loginUID)
	h.POST("/claim", inject, s.claimUID)
	h.POST("/bind", inject, s.bindPhone)
	h.GET("/binding", inject, s.getPhoneBinding)
	h.POST("/reset", inject, s.resetUIDPassword)
	call := func(method, path string, body any, agent, session string, want int) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		resp := ut.PerformRequest(h.Engine, method, path, &ut.Body{Body: bytes.NewReader(data), Len: len(data)}, ut.Header{Key: "Content-Type", Value: "application/json"}, ut.Header{Key: "Test-Agent", Value: agent}, ut.Header{Key: "Test-Session", Value: session})
		if resp.Code != want {
			t.Fatalf("%s got %d want %d: %s", path, resp.Code, want, resp.Body.String())
		}
		var result map[string]any
		_ = json.Unmarshal(resp.Body.Bytes(), &result)
		return result
	}
	send := func(phone, agent string) string {
		t.Helper()
		out := call("POST", "/send", phoneRequest{Phone: phone, Purpose: "register"}, agent, "", 200)
		data := out["data"].(map[string]any)
		if _, ok := data["code"]; ok {
			t.Fatal("OTP leaked in send response")
		}
		return data["challenge_id"].(string)
	}
	register := func(phone, agent, id string, want int) map[string]any {
		t.Helper()
		return call("POST", "/register", uidRequest{AgreementVersion: twinAgreementVersion, Password: "test-password-123", Phone: phone, ChallengeID: id, Code: sender.code(id)}, agent, "", want)
	}
	call("POST", "/register", uidRequest{AgreementVersion: twinAgreementVersion, Password: "test-password-123"}, "1", "", 400)
	s.phoneSender = nil
	call("POST", "/send", phoneRequest{Phone: "13800138000", Purpose: "register"}, "1", "", 503)
	s.phoneSender = sender
	id := send("13800138000", "1")
	call("POST", "/send", phoneRequest{Phone: "13800138000", Purpose: "register"}, "1", "", 429)
	call("POST", "/register", uidRequest{AgreementVersion: twinAgreementVersion, Password: "test-password-123", Phone: "13800138000", ChallengeID: id, Code: sender.code(id)}, "2", "", 400)
	call("POST", "/register", uidRequest{AgreementVersion: twinAgreementVersion, Password: "test-password-123", Phone: "13800138001", ChallengeID: id, Code: sender.code(id)}, "1", "", 400)
	owner := register("+8613800138000", "1", id, 201)["data"].(map[string]any)
	if len(owner["uid"].(string)) != 5 {
		t.Fatal("random public UID was not allocated", owner)
	}
	register("13800138000", "1", id, 400)
	// A new proof for an already-bound phone cannot create a second account.
	r.FastForward(time.Minute)
	duplicate := send("13800138000", "2")
	register("13800138000", "2", duplicate, 409)
	var count int64
	_ = db.Raw(`SELECT count(*) FROM human_accounts WHERE phone_hash IS NOT NULL`).Scan(&count).Error
	if count != 1 {
		t.Fatal("duplicate account persisted")
	}
	// The same valid owner credentials cannot claim a second network identity.
	blocked := call("POST", "/claim", uidRequest{UID: owner["uid"].(string), Password: "test-password-123"}, "2", "", 409)
	if blocked["error"].(map[string]any)["code"] != "OWNER_HAS_AGENT" {
		t.Fatal("second identity was not rejected by the owner limit", blocked)
	}
	// Attempts persist even though failed registration does not create an owner.
	wrong := send("13800138002", "3")
	for i := 0; i < 5; i++ {
		code := "000000"
		if sender.code(wrong) == code {
			code = "999999"
		}
		call("POST", "/register", uidRequest{AgreementVersion: twinAgreementVersion, Password: "test-password-123", Phone: "13800138002", ChallengeID: wrong, Code: code}, "3", "", 400)
	}
	register("13800138002", "3", wrong, 400)
	expired := send("13800138003", "4")
	_ = db.Exec(`UPDATE human_phone_challenges SET expires_at=1 WHERE challenge_id=?`, expired).Error
	register("13800138003", "4", expired, 400)
	sender.fail = true
	call("POST", "/send", phoneRequest{Phone: "13800138004", Purpose: "register"}, "5", "", 503)
	sender.fail = false
	var failed string
	_ = db.Raw(`SELECT challenge_id FROM human_phone_challenges WHERE phone_hash=?`, s.phoneHash("13800138004")).Scan(&failed).Error
	call("POST", "/register", uidRequest{AgreementVersion: twinAgreementVersion, Password: "test-password-123", Phone: "13800138004", ChallengeID: failed, Code: "123456"}, "5", "", 400)
	// An owner conflict rolls back account creation and proof consumption together.
	rollback := send("13800138005", "6")
	_ = db.Exec(`INSERT INTO agent_owners VALUES(6,'u_legacy_first',1)`).Error
	register("13800138005", "6", rollback, 409)
	_ = db.Exec(`DELETE FROM agent_owners WHERE agent_id=6`).Error
	register("13800138005", "6", rollback, 201)
	// New accounts receive distinct random five-digit UIDs, independent of legacy sequence.
	nines := send("13800138006", "7")
	first := register("13800138006", "7", nines, 201)["data"].(map[string]any)["uid"].(string)
	six := send("13800138007", "8")
	second := register("13800138007", "8", six, 201)["data"].(map[string]any)["uid"].(string)
	if len(first) != 5 || len(second) != 5 || first == second || first == owner["uid"] {
		t.Fatal("random UID uniqueness failed")
	}
	// Operator-assigned owner UID follows the same verified registration path,
	// even while public issuance is paused. Browser UID input cannot choose a number.
	r.FastForward(time.Hour)
	if err := owneruid.Admin(db, owneruid.Command{Action: "assign", Number: 12345678901, AgentID: 9, Actor: "test", Reason: "internal account"}); err != nil {
		t.Fatal(err)
	}
	var issuedBefore int64
	_ = db.Raw(`SELECT issued FROM owner_uid_batches WHERE name='founding-5'`).Scan(&issuedBefore).Error
	if issuedBefore != 4 {
		t.Fatal("failed registration consumed a public slot", issuedBefore)
	}
	if err := owneruid.Admin(db, owneruid.Command{Action: "pause", Actor: "test", Reason: "manual pause"}); err != nil {
		t.Fatal(err)
	}
	manualProof := send("13800138009", "9")
	manual := call("POST", "/register", uidRequest{UID: "77777", AgreementVersion: twinAgreementVersion, Password: "test-password-123", Phone: "13800138009", ChallengeID: manualProof, Code: sender.code(manualProof)}, "9", "", 201)
	if manual["data"].(map[string]any)["uid"] != "12345678901" {
		t.Fatal("operator UID was not delivered", manual)
	}
	var issuedAfter int64
	_ = db.Raw(`SELECT issued FROM owner_uid_batches WHERE name='founding-5'`).Scan(&issuedAfter).Error
	if issuedBefore != issuedAfter {
		t.Fatal("manual assignment consumed public quota")
	}
	pausedProof := send("13800138010", "10")
	paused := register("13800138010", "10", pausedProof, 503)
	if paused["error"].(map[string]any)["code"] != "UID_BATCH_CLOSED" {
		t.Fatal("missing batch pause error", paused)
	}
	if err := owneruid.Admin(db, owneruid.Command{Action: "resume", Name: "founding-5", Actor: "test", Reason: "manual resume"}); err != nil {
		t.Fatal(err)
	}
	register("13800138010", "10", pausedProof, 201)
	// Legacy credentials work with both numeric UID and the original private alias.
	hash, _ := bcrypt.GenerateFromPassword([]byte("legacy-password-123"), bcrypt.DefaultCost)
	_ = db.Exec(`UPDATE human_accounts SET password_hash=?,recovery_hash=? WHERE uid='u_legacy_first'`, string(hash), keyedHash(s.otpPepper, "legacy-recovery")).Error
	for _, uid := range []string{"10000", "u_legacy_first"} {
		out := call("POST", "/login", uidRequest{UID: uid, Password: "legacy-password-123"}, "20", "", 200)
		if out["data"].(map[string]any)["uid"] != "10000" {
			t.Fatal("legacy alias leaked or login failed")
		}
	}
	// Legacy owner can bind a phone; proof requires the password and same owner session.
	_ = db.Exec(`INSERT INTO console_v2_sessions(session_id,agent_id,owner_uid,auth_method,status) VALUES('legacy-browser',20,'u_legacy_first','uid_password','active')`).Error
	bound := call("POST", "/send", phoneRequest{Phone: "13800138008", Purpose: "bind"}, "20", "legacy-browser", 200)["data"].(map[string]any)["challenge_id"].(string)
	bind := phoneRequest{Phone: "13800138008", UID: "10000", Password: "wrong", ChallengeID: bound, Code: sender.code(bound)}
	call("POST", "/bind", bind, "20", "legacy-browser", 401)
	bind.Password = "legacy-password-123"
	call("POST", "/bind", bind, "20", "legacy-browser", 200)
	status := call("GET", "/binding", nil, "20", "legacy-browser", 200)["data"].(map[string]any)
	if status["verified"] != true || status["masked_phone"] != "*******8008" {
		t.Fatal("binding not masked", status)
	}
	reset := call("POST", "/reset", uidRequest{UID: "10000", Password: "rotated-password-123", RecoveryKey: "legacy-recovery"}, "20", "", 200)
	if reset["data"].(map[string]any)["uid"] != "10000" {
		t.Fatal("recovery returned opaque uid")
	}
	call("POST", "/reset", uidRequest{UID: "10000", Password: "rotated-password-123", RecoveryKey: "legacy-recovery"}, "20", "", 401)
	var original string
	_ = db.Raw(`SELECT owner_uid FROM agent_owners WHERE agent_id=20`).Scan(&original).Error
	if original != "u_legacy_first" {
		t.Fatal("legacy foreign key changed")
	}
}
