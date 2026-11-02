package consolev2

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

// This transport grants only collaboration access. It never creates owner accounts,
// console sessions, social permissions, or credentials for a model/host account.
func (s *Service) registerInstallationRoutes(h *server.Hertz) {
	h.POST("/api/v2/plugin/connect", s.installationAuth(true), s.connectInstallation)
	for _, group := range []string{"project", "membership", "tasks", "context", "updates", "submit", "review"} {
		h.POST("/api/v2/plugin/collaboration/"+group, s.installationAuth(false), s.collaborationHandler(group))
	}
}

type installationRow struct {
	AgentID   int64
	ShortID   string
	Name      string
	RevokedAt *int64
}

func installationProof(origin, path, timestamp, nonce string, body []byte) string {
	hash := sha256.Sum256(body)
	return strings.Join([]string{"ELSEWHERE-COLLABORATION-V1", origin, "POST", path, timestamp, nonce, hex.EncodeToString(hash[:])}, "\n")
}

func (s *Service) installationAuth(enroll bool) app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		deny := func(status int) {
			fail(c, status, "COLLABORATION_CONNECTION_REQUIRED", "collaboration connection unavailable", nil)
			c.Abort()
		}
		body := c.Request.Body()
		if len(body) > collaborationRequestBytes {
			deny(413)
			return
		}
		publicText := string(c.GetHeader("X-Elsewhere-Key"))
		public, err := base64.RawURLEncoding.DecodeString(publicText)
		signature, sigErr := base64.RawURLEncoding.DecodeString(string(c.GetHeader("X-Elsewhere-Proof")))
		timestamp, nonce := string(c.GetHeader("X-Elsewhere-Time")), string(c.GetHeader("X-Elsewhere-Nonce"))
		seconds, timeErr := strconv.ParseInt(timestamp, 10, 64)
		now := time.Now().Unix()
		nonceBytes, nonceErr := hex.DecodeString(nonce)
		origin, originErr := url.Parse(s.publicURL)
		if err != nil || len(public) != ed25519.PublicKeySize || base64.RawURLEncoding.EncodeToString(public) != publicText || sigErr != nil || timeErr != nil || strconv.FormatInt(seconds, 10) != timestamp || seconds < now-120 || seconds > now+120 || nonceErr != nil || len(nonceBytes) != 16 || originErr != nil || origin.Host == "" {
			deny(401)
			return
		}
		message := installationProof(origin.Scheme+"://"+origin.Host, string(c.Path()), timestamp, nonce, body)
		if !ed25519.Verify(public, []byte(message), signature) {
			deny(401)
			return
		}
		fingerprintBytes := sha256.Sum256(public)
		fingerprint := hex.EncodeToString(fingerprintBytes[:])
		var row installationRow
		status := 401
		err = s.db.Transaction(func(tx *gorm.DB) error {
			if e := tx.Raw(`SELECT i.agent_id,i.revoked_at,a.short_id,a.agent_name AS name FROM collaboration_installations i JOIN agents a USING(agent_id) WHERE key_fingerprint=? AND a.identity_state='active'`, fingerprint).Scan(&row).Error; e != nil {
				return e
			}
			if row.RevokedAt != nil || (!enroll && row.AgentID == 0) {
				return errUnauthorized
			}
			var count int
			bucket := fmt.Sprintf("request:%s:%d", fingerprint, now/60)
			if e := tx.Raw(`INSERT INTO collaboration_connection_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=collaboration_connection_limits.count+1 RETURNING count`, bucket, now+120).Scan(&count).Error; e != nil {
				return e
			}
			// Polling, membership checks and lease heartbeats share this key.
			// Allow normal multi-session traffic while keeping a bounded ceiling.
			if count > 600 {
				status = 429
				return errUnauthorized
			}
			if e := tx.Exec(`DELETE FROM collaboration_proofs WHERE expires_at<?`, now).Error; e != nil {
				return e
			}
			proof := tx.Exec(`INSERT INTO collaboration_proofs VALUES(?,?,?) ON CONFLICT DO NOTHING`, fingerprint, nonce, now+300)
			if proof.Error != nil {
				return proof.Error
			}
			if proof.RowsAffected != 1 {
				return errUnauthorized
			}
			if enroll && row.AgentID == 0 {
				// Serialize retries from the same persisted key; never create a replacement.
				if e := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?,0))`, fingerprint).Error; e != nil {
					return e
				}
				if e := tx.Raw(`SELECT i.agent_id,i.revoked_at,a.short_id,a.agent_name AS name FROM collaboration_installations i JOIN agents a USING(agent_id) WHERE key_fingerprint=?`, fingerprint).Scan(&row).Error; e != nil {
					return e
				}
				if row.RevokedAt != nil {
					return errUnauthorized
				}
				if row.AgentID == 0 {
					ipHash := sha256.Sum256([]byte(s.otpPepper + "|" + c.ClientIP()))
					bucket = fmt.Sprintf("enroll:%x:%d", ipHash, now/3600)
					if e := tx.Raw(`INSERT INTO collaboration_connection_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=collaboration_connection_limits.count+1 RETURNING count`, bucket, now+7200).Scan(&count).Error; e != nil {
						return e
					}
					if count > 20 {
						status = 429
						return errUnauthorized
					}
					var req struct {
						DisplayName string `json:"display_name"`
					}
					if json.Unmarshal(body, &req) != nil || len(req.DisplayName) > 80 || strings.ContainsRune(req.DisplayName, 0) {
						status = 400
						return errUnauthorized
					}
					name := strings.TrimSpace(req.DisplayName)
					if name == "" {
						name = "Elsewhere Agent"
					}
					if s.idgen == nil {
						return fmt.Errorf("identity generator unavailable")
					}
					id, e := s.idgen.NextID()
					if e != nil {
						return e
					}
					if e = insertProvisionedAgent(tx, id, "collaboration-"+fingerprint+"@installation.invalid", name, now*1000); e != nil {
						return e
					}
					if e = tx.Exec(`INSERT INTO collaboration_installations(key_fingerprint,public_key,agent_id,created_at) VALUES(?,?,?,?)`, fingerprint, publicText, id, now*1000).Error; e != nil {
						return e
					}
					if e = tx.Raw(`SELECT agent_id,short_id,agent_name AS name FROM agents WHERE agent_id=?`, id).Scan(&row).Error; e != nil {
						return e
					}
				}
			}
			if _, e := collabOwner(tx, strconv.FormatInt(row.AgentID, 10)); e != nil {
				return errUnauthorized
			}
			return tx.Exec(`DELETE FROM collaboration_connection_limits WHERE expires_at<?`, now).Error
		})
		if err != nil {
			if err != errUnauthorized {
				status = 503
			}
			deny(status)
			return
		}
		c.Set("agent_id", row.AgentID)
		c.Set("collaboration_installation", row)
		c.Next(ctx)
	}
}

func (s *Service) connectInstallation(_ context.Context, c *app.RequestContext) {
	value, ok := c.Get("collaboration_installation")
	if !ok {
		fail(c, 401, "COLLABORATION_CONNECTION_REQUIRED", "connection required", nil)
		return
	}
	row := value.(installationRow)
	reply(c, 200, map[string]any{"state": "connected", "agent_id": strconv.FormatInt(row.AgentID, 10), "short_id": row.ShortID, "display_name": row.Name, "identity_kind": "installation_key", "ready_for_collaboration": true})
}
