package consolev2

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
)

func TestIdentityRecoveryUnboundHome(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated full schema required")
	}
	db := socialFixtureDB(t, dsn)
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// Existing and absent target IDs must give the same response to an unbound
	// key. Knowing an account ID must not grant access or reveal its existence.
	check(insertProvisionedAgent(db, 989001, "recovery-fixture@identity.invalid", "Fixture", time.Now().UnixMilli()))
	s := &Service{db: db, bootstrapSecret: "recovery-test-only", otpPepper: "recovery-test-only", idgen: &fixedIDGenerator{id: 989100}}
	h := server.New()
	h.POST("/provision", s.provision)
	for _, tc := range []struct {
		name, target, invalid string
		status                int
		code                  string
	}{
		{"absent identity", "989002", "", http.StatusConflict, "IDENTITY_RECOVERY_REQUIRED"},
		{"another identity", "989001", "", http.StatusConflict, "IDENTITY_RECOVERY_REQUIRED"},
		{"expired grant", "989002", "grant", http.StatusUnauthorized, "BOOTSTRAP_PROOF_REJECTED"},
		{"consumed nonce", "989002", "nonce", http.StatusUnauthorized, "BOOTSTRAP_PROOF_REJECTED"},
		{"invalid signature", "989002", "signature", http.StatusUnauthorized, "INVALID_PROOF"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pub, private, err := ed25519.GenerateKey(rand.Reader)
			check(err)
			grant, err := s.issueBootstrapGrantRecord(issueGrantRequest{
				EntitlementID: "recovery-" + tc.name, IdempotencyKey: "recovery-test-" + tc.name,
				Channel: "test", Policy: "limited",
			}, pub)
			check(err)
			if tc.invalid == "grant" {
				check(db.Exec(`UPDATE agent_bootstrap_grants SET expires_at=1 WHERE jti_hash=?`, hashString(grant.BootstrapGrant)).Error)
			}
			if tc.invalid == "nonce" {
				check(db.Exec(`UPDATE agent_signature_nonces SET consumed_at=1 WHERE nonce_hash=?`, hashString(grant.Nonce)).Error)
			}
			req := provisionRequest{
				BootstrapGrant: grant.BootstrapGrant, Nonce: grant.Nonce,
				IdempotencyKey: "provision-recovery-" + tc.name,
				PublicKey:      base64.RawURLEncoding.EncodeToString(pub), IssuedAt: time.Now().UnixMilli(),
				ExpectedAgentID: tc.target, AgentName: "Must not be created", Draft: json.RawMessage(`{}`),
			}
			transcript, err := provisionTranscript(req)
			check(err)
			req.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, transcript))
			if tc.invalid == "signature" {
				_, wrong, err := ed25519.GenerateKey(rand.Reader)
				check(err)
				req.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(wrong, transcript))
			}
			status, payload, _ := performJSON(t, h, "POST", "/provision", req)
			if status != tc.status || responseErrorCode(t, payload) != tc.code {
				t.Fatalf("status=%d payload=%v", status, payload)
			}
			var principals, sessions, agents int64
			check(db.Raw(`SELECT count(*) FROM agent_principals WHERE key_fingerprint=?`, fingerprint(pub)).Scan(&principals).Error)
			check(db.Raw(`SELECT count(*) FROM agent_credential_sessions`).Scan(&sessions).Error)
			check(db.Raw(`SELECT count(*) FROM agents WHERE agent_name='Must not be created'`).Scan(&agents).Error)
			if principals != 0 || sessions != 0 || agents != 0 {
				t.Fatalf("failed recovery created state: principals=%d sessions=%d agents=%d", principals, sessions, agents)
			}
		})
	}
}
