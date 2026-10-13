package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

// This optional context extension travels with the existing Attention snapshot.
// Scope is per choice; a different choice never inherits another choice's grant.
type momentContext struct {
	RelatedAgentID string            `json:"related_agent_id,omitempty"`
	Priority       int               `json:"priority"`
	ExecutorID     string            `json:"executor_id"`
	Scopes         map[string]string `json:"scopes"`
}

func validateMomentContext(m *momentContext, actions []attentionProtocolAction) error {
	if m == nil {
		return nil
	}
	if m.Priority < 0 || m.Priority > 100 || !attentionActionKeyPattern.MatchString(m.ExecutorID) {
		return errors.New("moment priority or executor_id is invalid")
	}
	if m.RelatedAgentID != "" {
		if id, e := strconv.ParseInt(m.RelatedAgentID, 10, 64); e != nil || id <= 0 {
			return errors.New("moment related_agent_id is invalid")
		}
	}
	keys := map[string]bool{}
	for _, a := range actions {
		keys[a.ActionKey] = true
	}
	if len(m.Scopes) != len(keys) {
		return errors.New("every moment choice requires its own scope")
	}
	for k, scope := range m.Scopes {
		if !keys[k] || strings.TrimSpace(scope) == "" || utf8.RuneCountInString(scope) > 2000 {
			return errors.New("moment scope is invalid")
		}
	}
	return nil
}

func (s *Service) registerMomentRoutes(h *server.Hertz) {
	if !s.enableAttentionV1 || !s.enableControl {
		return
	}
	h.GET("/api/v2/console/moment", s.consoleAuth(false), s.requireCompleted, s.listMoment)
	h.POST("/api/v2/console/moment/:attention_id/state", s.consoleAuth(true), s.requireCompleted, s.changeMomentState)
	h.POST("/api/v2/agent-commands/:command_id/renew", s.agentAuth("commands:claim"), s.requireCompleted, s.renewMomentCommand)
}

// Expiration is checked by the queue as well as by the UI, including when no
// owner has opened the page. A fenced or expired job is never offered again.
func expireMomentCommands(tx *gorm.DB, agent int64) error {
	if e := tx.Exec(`WITH lost AS (UPDATE agent_commands SET status='failed',completed_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
 result='{"summary":"执行租约已失效，结果未确认；没有自动重复执行。请核对已有影响。"}'::jsonb
 WHERE agent_id=? AND command_type='attention_response' AND status='claimed' AND claim_until<=(extract(epoch FROM clock_timestamp())*1000)::bigint
 RETURNING attention_id,agent_id)
 UPDATE agent_attention_items i SET status='open',response_status='failed',item_revision=item_revision+1,updated_at=(extract(epoch FROM clock_timestamp())*1000)::bigint
 FROM lost WHERE i.attention_id=lost.attention_id AND i.agent_id=lost.agent_id AND i.status='pending'`, agent).Error; e != nil {
		return e
	}
	return tx.Exec(`UPDATE agent_commands c SET status='expired', completed_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,
 result=jsonb_build_object('summary','决定已过期，未继续执行。')
 WHERE c.agent_id=? AND c.command_type='attention_response' AND c.status IN ('pending','notified','claimed')
 AND EXISTS(SELECT 1 FROM agent_attention_items i WHERE i.agent_id=c.agent_id AND i.attention_id=c.attention_id
 AND (i.expires_at <= (extract(epoch FROM clock_timestamp())*1000)::bigint OR i.status IN ('dismissed','expired')))`, agent).Error
}

func momentClaimAllowed(tx *gorm.DB, agent, command int64, executor string) error {
	var ok bool
	if e := tx.Raw(`SELECT EXISTS(SELECT 1 FROM agent_commands c JOIN agent_attention_items i ON i.agent_id=c.agent_id AND i.attention_id=c.attention_id
 WHERE c.agent_id=? AND c.command_id=? AND i.status NOT IN ('dismissed','expired')
 AND i.expires_at > (extract(epoch FROM clock_timestamp())*1000)::bigint
 AND (COALESCE(c.payload->'context_ref'->'moment'->>'executor_id','')='' OR c.payload->'context_ref'->'moment'->>'executor_id'=?))`, agent, command, executor).Scan(&ok).Error; e != nil {
		return e
	}
	if !ok {
		return errConflict
	}
	return nil
}

func (s *Service) listMoment(_ context.Context, c *app.RequestContext) {
	agent, _ := agentID(c)
	cursor, e := decodeAttentionCursor(c.Query("cursor"))
	if e != nil {
		fail(c, 400, "INVALID_CURSOR", "分页位置无效", nil)
		return
	}
	if e = expireMomentCommands(s.db, agent); e != nil {
		s.socialFailure(c, e)
		return
	}
	type row struct {
		Item             attentionView `gorm:"embedded"`
		CommandID        *int64
		CommandStatus    string
		CommandResult    string
		CommandPayload   string
		CommandCreatedAt *int64
		CompletedAt      *int64
		PeerName         string
		PeerID           string
	}
	var rows []row
	// Names come from the identity table, never from an Agent-authored display name.
	query := strings.Replace(attentionSelect, "FROM agent_attention_items item", `, cmd.command_id, COALESCE(cmd.status,'') AS command_status,
 COALESCE(cmd.result,'{}'::jsonb)::text AS command_result, COALESCE(cmd.payload,'{}'::jsonb)::text AS command_payload,
 cmd.created_at AS command_created_at, cmd.completed_at,
 COALESCE(peer.agent_name,'') AS peer_name, COALESCE(peer.agent_id::text,'') AS peer_id
 FROM agent_attention_items item
 LEFT JOIN LATERAL (SELECT * FROM agent_commands q WHERE q.agent_id=item.agent_id AND q.attention_id=item.attention_id AND q.command_type='attention_response' ORDER BY q.created_at DESC,q.command_id DESC LIMIT 1) cmd ON true
 LEFT JOIN agents peer ON peer.agent_id::text=COALESCE(NULLIF(item.context_ref->'moment'->>'related_agent_id',''),item.agent_id::text)
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=item.agent_id AND b.to_uid=peer.agent_id) OR (b.to_uid=item.agent_id AND b.from_uid=peer.agent_id)))`, 1)
	query += ` WHERE item.agent_id=? AND item.producer='agent' AND item.protocol_version='agent_attention.v1'`
	args := []any{agent}
	if cursor.AttentionID > 0 {
		query += ` AND (item.created_at,item.attention_id)<(?,?)`
		args = append(args, cursor.CreatedAt, cursor.AttentionID)
	}
	query += ` ORDER BY item.created_at DESC,item.attention_id DESC LIMIT 50`
	if e = s.db.Raw(query, args...).Scan(&rows).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		item := attentionResponse(r.Item)
		var result, payload map[string]any
		_ = json.Unmarshal([]byte(r.CommandResult), &result)
		_ = json.Unmarshal([]byte(r.CommandPayload), &payload)
		item["related_agent"] = map[string]any{"agent_id": r.PeerID, "name": r.PeerName}
		if r.CommandID != nil {
			item["command"] = map[string]any{"command_id": fmt.Sprint(*r.CommandID), "status": r.CommandStatus, "result": result, "condition": payload["condition"], "authorization_scope": payload["authorization_scope"], "selected_at": payload["selected_at"], "revoked_at": payload["revoked_at"], "completed_at": r.CompletedAt}
		}
		items = append(items, item)
	}
	next := ""
	if len(rows) == 50 {
		r := rows[len(rows)-1]
		next = encodeAttentionCursor(attentionCursor{CreatedAt: r.Item.CreatedAt, AttentionID: r.Item.AttentionID})
	}
	reply(c, 200, map[string]any{"items": items, "next_cursor": next, "server_time": time.Now().UnixMilli()})
}

func (s *Service) changeMomentState(_ context.Context, c *app.RequestContext) {
	agent, _ := agentID(c)
	id, e := strconv.ParseInt(c.Param("attention_id"), 10, 64)
	var req struct {
		ExpectedRevision int64  `json:"expected_item_revision"`
		Action           string `json:"action"`
	}
	if e != nil || id <= 0 || decodeBody(c, &req) != nil || req.ExpectedRevision <= 0 || (req.Action != "defer" && req.Action != "reopen" && req.Action != "revoke") {
		fail(c, 400, "INVALID_MOMENT_STATE", "事项操作无效", nil)
		return
	}
	e = s.db.Transaction(func(tx *gorm.DB) error {
		// Lock commands before the item, matching claim and completion lock order.
		var commands []struct {
			CommandID  int64
			Status     string
			ClaimUntil *int64
		}
		if e := tx.Raw(`SELECT command_id,status,claim_until FROM agent_commands WHERE agent_id=? AND attention_id=? AND status IN ('pending','notified','claimed') ORDER BY command_id FOR UPDATE`, agent, id).Scan(&commands).Error; e != nil {
			return e
		}
		var item struct {
			Status    string
			Revision  int64
			ExpiresAt int64
		}
		if e := tx.Raw(`SELECT status,item_revision AS revision,expires_at FROM agent_attention_items WHERE agent_id=? AND attention_id=? AND producer='agent' AND protocol_version='agent_attention.v1' FOR UPDATE`, agent, id).Scan(&item).Error; e != nil {
			return e
		}
		now := time.Now().UnixMilli()
		if item.Revision != req.ExpectedRevision || item.ExpiresAt <= now {
			return errConflict
		}
		next := "dismissed"
		switch req.Action {
		case "reopen":
			if item.Status != "dismissed" || len(commands) > 0 {
				return errConflict
			}
			next = "open"
		case "defer":
			if item.Status != "open" || len(commands) > 0 {
				return errConflict
			}
		case "revoke":
			if len(commands) == 0 {
				return errConflict
			}
			// In-flight external work cannot be rolled back by a webpage. Refuse to
			// promise cancellation once a worker has started, even after lease loss.
			for _, q := range commands {
				if q.Status == "claimed" {
					return errors.New("MOMENT_EXECUTING")
				}
			}
			if e := tx.Exec(`UPDATE agent_commands SET status='failed',completed_at=?,payload=payload||jsonb_build_object('revoked_at',CAST(? AS bigint)),result='{"summary":"主人已撤回，未执行。"}'::jsonb WHERE agent_id=? AND attention_id=? AND status IN ('pending','notified')`, now, now, agent, id).Error; e != nil {
				return e
			}
		}
		return tx.Exec(`UPDATE agent_attention_items SET status=?,response_status='none',selected_action_key=NULL,item_revision=item_revision+1,updated_at=? WHERE agent_id=? AND attention_id=?`, next, now, agent, id).Error
	})
	if e != nil {
		if e.Error() == "MOMENT_EXECUTING" {
			fail(c, 409, "MOMENT_EXECUTING", "Agent 已领取并开始处理，不能撤回；请等待执行回执。", nil)
		} else if errors.Is(e, errConflict) {
			fail(c, 409, "ATTENTION_CONFLICT", "事项已变化或过期，请刷新后核对。", nil)
		} else {
			s.socialFailure(c, e)
		}
		return
	}
	reply(c, 200, map[string]any{"item_revision": req.ExpectedRevision + 1})
}

func (s *Service) renewMomentCommand(_ context.Context, c *app.RequestContext) {
	agent, _ := agentID(c)
	id, e := strconv.ParseInt(c.Param("command_id"), 10, 64)
	var req struct {
		RuntimeID  string `json:"runtime_instance_id"`
		Token      string `json:"claim_token"`
		Epoch      int64  `json:"claim_epoch"`
		ExecutorID string `json:"executor_id"`
	}
	if e != nil || id <= 0 || decodeBody(c, &req) != nil || req.RuntimeID == "" || req.Token == "" || req.Epoch <= 0 {
		fail(c, 400, "INVALID_REQUEST", "领取凭证无效", nil)
		return
	}
	var until int64
	e = s.db.Transaction(func(tx *gorm.DB) error {
		var locked int64
		if e := tx.Raw(`SELECT command_id FROM agent_commands WHERE command_id=? AND agent_id=? FOR UPDATE`, id, agent).Scan(&locked).Error; e != nil {
			return e
		}
		if e := momentClaimAllowed(tx, agent, id, req.ExecutorID); e != nil {
			return e
		}
		return tx.Raw(`UPDATE agent_commands c SET claim_until=LEAST((extract(epoch FROM clock_timestamp())*1000)::bigint+120000,i.expires_at)
  FROM agent_attention_items i WHERE c.agent_id=? AND c.command_id=? AND c.command_type='attention_response'
  AND i.agent_id=c.agent_id AND i.attention_id=c.attention_id AND c.status='claimed' AND c.claim_owner_runtime_id=? AND c.claim_epoch=? AND c.claim_token_hash=?
  AND c.claim_until>(extract(epoch FROM clock_timestamp())*1000)::bigint
  AND EXISTS(SELECT 1 FROM agent_runtime_leases l WHERE l.agent_id=c.agent_id AND l.runtime_instance_id=? AND l.lease_until>(extract(epoch FROM clock_timestamp())*1000)::bigint)
  RETURNING c.claim_until`, agent, id, req.RuntimeID, req.Epoch, hashString(req.Token), req.RuntimeID).Scan(&until).Error
	})
	if e != nil || until == 0 {
		fail(c, 409, "CLAIM_FENCED", "任务领取已失效、被撤回或过期。", nil)
		return
	}
	reply(c, 200, map[string]any{"claim_until": until})
}
