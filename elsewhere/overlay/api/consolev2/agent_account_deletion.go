package consolev2

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

func (s *Service) agentDeletionHash(agent, key string) string {
	return keyedHash(s.otpPepper, "agent-account-deleted\x00"+agent+"\x00"+key)
}

func (s *Service) retainAgentDeletionProofs(tx *gorm.DB, agents []int64) error {
	var keys []struct {
		AgentID        int64
		KeyFingerprint string
	}
	if err := tx.Raw("SELECT agent_id,key_fingerprint FROM agent_principals WHERE agent_id IN ?", agents).Scan(&keys).Error; err != nil {
		return err
	}
	for _, key := range keys {
		if err := tx.Exec("INSERT INTO agent_account_deletions(proof_hash,deleted_at) VALUES(?,?) ON CONFLICT DO NOTHING",
			s.agentDeletionHash(strconv.FormatInt(key.AgentID, 10), key.KeyFingerprint), time.Now().UnixMilli()).Error; err != nil {
			return err
		}
	}
	return nil
}

// The old private key authenticates this read without a live session. Absence
// is deliberately not proof of deletion (expired credentials, suspension, etc.).
func (s *Service) agentDeletionStatus(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "private, no-store")
	var req struct {
		AgentID   string `json:"agent_id"`
		PublicKey string `json:"public_key"`
		IssuedAt  int64  `json:"issued_at"`
		Nonce     string `json:"nonce"`
		Signature string `json:"signature"`
	}
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_REQUEST", "invalid account status proof", nil)
		return
	}
	id, err := strconv.ParseInt(req.AgentID, 10, 64)
	publicKey, keyErr := decodePublicKey(req.PublicKey)
	signature, sigErr := base64.RawURLEncoding.DecodeString(req.Signature)
	now := time.Now().UnixMilli()
	transcript := strings.Join([]string{"ELSEWHERE-ACCOUNT-DELETION-V1", req.AgentID, strconv.FormatInt(req.IssuedAt, 10), req.Nonce}, "\n")
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != req.AgentID || keyErr != nil || sigErr != nil ||
		len(req.Nonce) < 32 || len(req.Nonce) > 128 || req.IssuedAt < now-300000 || req.IssuedAt > now+300000 ||
		!ed25519.Verify(publicKey, []byte(transcript), signature) {
		fail(c, 401, "DELETION_PROOF_INVALID", "invalid account status proof", nil)
		return
	}
	if !s.uidRate(ctx, c, "agent-deletion:"+fingerprint(publicKey)) {
		return
	}
	var deletedAt int64
	if err := s.db.Raw("SELECT deleted_at FROM agent_account_deletions WHERE proof_hash=?",
		s.agentDeletionHash(req.AgentID, fingerprint(publicKey))).Scan(&deletedAt).Error; err != nil {
		fail(c, 503, "DELETION_STATUS_UNAVAILABLE", "account status is temporarily unavailable", nil)
		return
	}
	status := "not_deleted"
	if deletedAt > 0 {
		status = "deleted"
	}
	reply(c, 200, map[string]any{"status": status, "agent_id": req.AgentID, "nonce": req.Nonce, "deleted_at": deletedAt})
}
