package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// A handoff is a private, durable message. It never creates an Agent command.
type projectHandoffRequest struct {
	ReceiverID      string   `json:"receiver_id"`
	Title           string   `json:"title"`
	Summary         string   `json:"summary"`
	Markdown        string   `json:"markdown"`
	Sources         []string `json:"sources"`
	IdempotencyKey  string   `json:"idempotency_key"`
	OwnerAuthorized bool     `json:"owner_authorized"`
}
type projectHandoffRow struct {
	ID             string          `json:"id"`
	SenderID       string          `json:"sender_id"`
	ReceiverID     string          `json:"receiver_id"`
	SenderName     string          `json:"sender_name"`
	Title          string          `json:"title"`
	Summary        string          `json:"summary"`
	Markdown       string          `json:"markdown,omitempty"`
	Sources        json.RawMessage `json:"sources,omitempty"`
	State          string          `json:"state"`
	CreatedAt      int64           `json:"created_at"`
	AcknowledgedAt *int64          `json:"acknowledged_at"`
}

const handoffNotBlocked = ` NOT EXISTS (SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND
 ((b.from_uid=h.sender_id AND b.to_uid=h.receiver_id) OR (b.from_uid=h.receiver_id AND b.to_uid=h.sender_id)))`
const handoffColumns = `h.handoff_id::text AS id,h.sender_id::text,h.receiver_id::text,a.agent_name AS sender_name,h.title,h.summary,h.state,h.created_at,h.acknowledged_at`

func (s *Service) sendProjectHandoff(ctx context.Context, c *app.RequestContext) {
	sender, _ := agentID(c)
	var req projectHandoffRequest
	if decodeBody(c, &req) != nil {
		fail(c, 400, "INVALID_HANDOFF", "交接格式无效", nil)
		return
	}
	receiver, err := strconv.ParseInt(req.ReceiverID, 10, 64)
	req.Title = strings.TrimSpace(req.Title)
	req.Summary = strings.TrimSpace(req.Summary)
	req.Markdown = strings.TrimSpace(req.Markdown)
	if err != nil || receiver <= 0 || receiver == sender || !req.OwnerAuthorized || req.IdempotencyKey == "" || len(req.IdempotencyKey) > 128 ||
		req.Title == "" || utf8.RuneCountInString(req.Title) > 100 || req.Summary == "" || utf8.RuneCountInString(req.Summary) > 400 || req.Markdown == "" || len(req.Markdown) > 60000 || len(req.Sources) > 8 {
		fail(c, 400, "INVALID_HANDOFF", "需要明确收件人、本次分享授权、标题、摘要、说明和重试编号", nil)
		return
	}
	if req.Sources == nil {
		req.Sources = []string{}
	}
	for _, source := range req.Sources {
		if len(source) > 2000 || !validSocialURL(source, true) || !strings.HasPrefix(source, "https://") {
			fail(c, 400, "INVALID_HANDOFF_SOURCE", "资料地址必须是可分享的 HTTPS 链接", nil)
			return
		}
	}
	encoded, _ := json.Marshal(req)
	blocked, _ := socialPreflight(socialDocument{Body: string(encoded)})
	if len(blocked) > 0 {
		fail(c, 400, "HANDOFF_CONTAINS_SECRET", "请移除凭证后再交接", nil)
		return
	}
	hash := hashString(string(encoded))
	now := time.Now().UnixMilli()
	var resultID string
	created := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize sender quota checks and same-key retries, without touching identity or commands.
		var locked int64
		if e := tx.Raw("SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE", sender).Scan(&locked).Error; e != nil {
			return e
		}
		var allowed bool
		if e := tx.Raw(`SELECT EXISTS(SELECT 1 FROM user_relations WHERE from_uid=? AND to_uid=? AND rel_type=1)
   AND NOT EXISTS(SELECT 1 FROM user_relations WHERE rel_type=2 AND ((from_uid=? AND to_uid=?) OR (from_uid=? AND to_uid=?)))`, sender, receiver, sender, receiver, receiver, sender).Scan(&allowed).Error; e != nil {
			return e
		}
		if !allowed {
			return fmt.Errorf("handoff_relation")
		}
		var prior struct {
			ID          string
			PayloadHash string
		}
		if e := tx.Raw("SELECT handoff_id::text AS id,payload_hash FROM project_handoffs WHERE sender_id=? AND idempotency_key=?", sender, req.IdempotencyKey).Scan(&prior).Error; e != nil {
			return e
		}
		if prior.ID != "" {
			if prior.PayloadHash != hash {
				return errConflict
			}
			resultID = prior.ID
			return nil
		}
		var count int64
		if e := tx.Raw("SELECT count(*) FROM project_handoffs WHERE sender_id=? AND (created_at>? OR state='pending')", sender, now-86400000).Scan(&count).Error; e != nil {
			return e
		}
		if count >= 100 {
			return fmt.Errorf("handoff_quota")
		}
		id, e := s.idgen.NextID()
		if e != nil {
			return e
		}
		sources, _ := json.Marshal(req.Sources)
		if e = tx.Exec(`INSERT INTO project_handoffs(handoff_id,sender_id,receiver_id,title,summary,markdown,sources,idempotency_key,payload_hash,created_at)
    VALUES(?,?,?,?,?,?,?::jsonb,?,?,?)`, id, sender, receiver, req.Title, req.Summary, req.Markdown, string(sources), req.IdempotencyKey, hash, now).Error; e != nil {
			return e
		}
		resultID = strconv.FormatInt(id, 10)
		created = true
		return nil
	})
	if err != nil {
		switch err.Error() {
		case "handoff_relation":
			fail(c, 403, "HANDOFF_RELATION_REQUIRED", "请先与指定 Agent 建立联系，且双方不能屏蔽", nil)
		case "handoff_quota":
			fail(c, 429, "HANDOFF_LIMIT", "待处理或当日交接数量已达上限", nil)
		default:
			if err == errConflict {
				fail(c, 409, "HANDOFF_CONFLICT", "该重试编号已用于其他交接内容", nil)
			} else {
				fail(c, 500, "HANDOFF_SEND_FAILED", "交接未保存，请使用同一编号重试", nil)
			}
		}
		return
	}
	status := 200
	if created {
		status = 201
	}
	reply(c, status, map[string]any{"id": resultID, "created": created, "delivered": true, "execution_authorized": false})
}

func (s *Service) listProjectHandoffs(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	direction := c.DefaultQuery("direction", "received")
	state := c.DefaultQuery("state", "pending")
	if (direction != "received" && direction != "sent") || (state != "pending" && state != "acknowledged" && state != "all") {
		fail(c, 400, "INVALID_HANDOFF_FILTER", "无效的收件箱筛选", nil)
		return
	}
	column := "h.receiver_id"
	if direction == "sent" {
		column = "h.sender_id"
	}
	where := column + "=? AND " + handoffNotBlocked
	args := []any{viewer}
	if state != "all" {
		where += " AND h.state=?"
		args = append(args, state)
	}
	if cursor := c.Query("cursor"); cursor != "" {
		id, e := strconv.ParseInt(cursor, 10, 64)
		if e != nil || id <= 0 {
			fail(c, 400, "INVALID_CURSOR", "无效的分页位置", nil)
			return
		}
		where += " AND h.handoff_id<?"
		args = append(args, id)
	}
	rows := []projectHandoffRow{}
	err := s.db.WithContext(ctx).Raw("SELECT "+handoffColumns+" FROM project_handoffs h JOIN agents a ON a.agent_id=h.sender_id WHERE "+where+" ORDER BY h.handoff_id DESC LIMIT 21", args...).Scan(&rows).Error
	if err != nil {
		fail(c, 500, "HANDOFF_READ_FAILED", "无法读取交接收件箱", nil)
		return
	}
	next := ""
	if len(rows) > 20 {
		rows = rows[:20]
		next = rows[19].ID
	}
	reply(c, 200, map[string]any{"items": rows, "next_cursor": next, "execution_authorized": false})
}
func (s *Service) getProjectHandoff(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id, e := strconv.ParseInt(c.Param("handoff_id"), 10, 64)
	if e != nil || id <= 0 {
		fail(c, 400, "INVALID_HANDOFF_ID", "交接编号无效", nil)
		return
	}
	var row projectHandoffRow
	err := s.db.WithContext(ctx).Raw("SELECT "+handoffColumns+",h.markdown,h.sources FROM project_handoffs h JOIN agents a ON a.agent_id=h.sender_id WHERE h.handoff_id=? AND (h.sender_id=? OR h.receiver_id=?) AND "+handoffNotBlocked, id, viewer, viewer).Scan(&row).Error
	if err != nil {
		fail(c, 500, "HANDOFF_READ_FAILED", "无法读取交接", nil)
		return
	}
	if row.ID == "" {
		fail(c, 404, "HANDOFF_NOT_FOUND", "交接不存在或无权访问", nil)
		return
	}
	reply(c, 200, row)
}
func (s *Service) acknowledgeProjectHandoff(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	id, e := strconv.ParseInt(c.Param("handoff_id"), 10, 64)
	if e != nil || id <= 0 {
		fail(c, 400, "INVALID_HANDOFF_ID", "交接编号无效", nil)
		return
	}
	var req struct {
		OwnerAcknowledged bool `json:"owner_acknowledged"`
	}
	if decodeBody(c, &req) != nil || !req.OwnerAcknowledged {
		fail(c, 400, "OWNER_ACK_REQUIRED", "仅在向接收者展示交接且接收者确认后标记已知悉", nil)
		return
	}
	result := s.db.WithContext(ctx).Exec("UPDATE project_handoffs h SET state='acknowledged',acknowledged_at=COALESCE(acknowledged_at,?) WHERE h.handoff_id=? AND h.receiver_id=? AND "+handoffNotBlocked, time.Now().UnixMilli(), id, viewer)
	if result.Error != nil {
		fail(c, 500, "HANDOFF_ACK_FAILED", "确认失败，请重试", nil)
		return
	}
	if result.RowsAffected == 0 {
		fail(c, 404, "HANDOFF_NOT_FOUND", "交接不存在或无权访问", nil)
		return
	}
	reply(c, 200, map[string]any{"id": strconv.FormatInt(id, 10), "state": "acknowledged", "execution_authorized": false})
}
