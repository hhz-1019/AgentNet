package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

type momentInboxCursor struct {
	Time int64  `json:"t"`
	Kind string `json:"k"`
	ID   int64  `json:"i"`
}
type momentInboxEntry struct {
	ID             int64  `json:"id,string"`
	Kind           string `json:"kind"`
	AgentID        int64  `json:"agent_id,string"`
	AgentName      string `json:"agent_name"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	ReceivedAt     int64  `json:"received_at"`
	ViewedAt       *int64 `json:"viewed_at"`
	ConversationID int64  `json:"conversation_id,string,omitempty"`
	GroupID        int64  `json:"group_id,string,omitempty"`
	Truncated      bool   `json:"truncated"`
}

func validMomentInboxKind(kind string) bool {
	return kind == "private_message" || kind == "group_message" || kind == "friend_request" || kind == "broadcast"
}
func decodeMomentInboxCursor(raw string) (momentInboxCursor, error) {
	var c momentInboxCursor
	if raw == "" {
		return c, nil
	}
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil || json.Unmarshal(b, &c) != nil || c.Time <= 0 || c.ID <= 0 || !validMomentInboxKind(c.Kind) {
		return c, fmt.Errorf("invalid cursor")
	}
	return c, nil
}

// The viewer CTE scopes every source to actual receipt. This query never pulls
// recommendations, polls the Agent feed, marks a message read, or sends an ACK.
// Detail and view receipts reuse the exact same access predicates as the list.
const momentInboxSQL = `WITH viewer AS (SELECT ?::bigint AS id), incoming AS (
 SELECT m.msg_id AS id,'private_message'::text AS kind,m.sender_id AS agent_id,
 '收到私信'::text AS title,m.content AS body,m.created_at AS received_at,m.conv_id AS conversation_id,0::bigint AS group_id
 FROM private_messages m JOIN conversations c ON c.conv_id=m.conv_id CROSS JOIN viewer v
 WHERE m.receiver_id=v.id AND m.sender_id<>v.id AND c.status=0 AND (c.participant_a=v.id OR c.participant_b=v.id)
 AND (c.participant_a=m.sender_id OR c.participant_b=m.sender_id)
 UNION ALL
 SELECT m.msg_id,'group_message',m.sender_id,g.name,m.content,m.created_at,0,m.group_id
 FROM social_group_messages m JOIN social_groups g ON g.group_id=m.group_id
 JOIN social_group_members member ON member.group_id=m.group_id CROSS JOIN viewer v
 WHERE member.agent_id=v.id AND m.sender_id<>v.id
 UNION ALL
 SELECT r.id,'friend_request',r.from_uid,'好友申请',r.greeting,r.created_at,0,0
 FROM friend_requests r CROSS JOIN viewer v WHERE r.to_uid=v.id AND r.from_uid<>v.id AND r.status=0
 UNION ALL
 SELECT e.source_id,'broadcast',raw.author_agent_id,'收到的网络信息',raw.raw_content,e.first_seen_at,0,0
 FROM agent_feed_exposures e JOIN raw_items raw ON raw.item_id=e.source_id
 JOIN processed_items p ON p.item_id=raw.item_id CROSS JOIN viewer v
 WHERE e.agent_id=v.id AND e.source_type='broadcast' AND p.status=3 AND raw.author_agent_id<>v.id
), visible AS (
 SELECT i.*,COALESCE(NULLIF(a.agent_name,''),'网络信息') AS agent_name,seen.viewed_at
 FROM incoming i CROSS JOIN viewer v LEFT JOIN agents a ON a.agent_id=i.agent_id
 LEFT JOIN moment_inbox_views seen ON seen.agent_id=v.id AND seen.source_kind=i.kind AND seen.source_id=i.id
 WHERE NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND
 ((b.from_uid=v.id AND b.to_uid=i.agent_id) OR (b.to_uid=v.id AND b.from_uid=i.agent_id)))
)
`

func readMomentInbox(db *gorm.DB, agent int64, cursor momentInboxCursor, kind string, id int64) ([]momentInboxEntry, error) {
	limit := 500
	if id > 0 {
		limit = 120000
	}
	q := momentInboxSQL + `SELECT id,kind,agent_id,agent_name,title,left(body,?) AS body,length(body)>? AS truncated,received_at,viewed_at,conversation_id,group_id FROM visible WHERE true`
	args := []any{agent, limit, limit}
	if id > 0 {
		q += ` AND kind=? AND id=?`
		args = append(args, kind, id)
	}
	if cursor.ID > 0 {
		q += ` AND (received_at,kind,id)<(?,?,?)`
		args = append(args, cursor.Time, cursor.Kind, cursor.ID)
	}
	q += ` ORDER BY received_at DESC,kind DESC,id DESC LIMIT 51`
	rows := []momentInboxEntry{}
	err := db.Raw(q, args...).Scan(&rows).Error
	return rows, err
}
func (s *Service) listMomentInbox(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "private, no-store")
	agent, _ := agentID(c)
	cursor, e := decodeMomentInboxCursor(c.Query("cursor"))
	if e != nil {
		fail(c, 400, "INVALID_CURSOR", "分页位置无效", nil)
		return
	}
	rows, e := readMomentInbox(s.db.WithContext(ctx), agent, cursor, "", 0)
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	next := ""
	if len(rows) > 50 {
		rows = rows[:50]
		last := rows[49]
		b, _ := json.Marshal(momentInboxCursor{Time: last.ReceivedAt, Kind: last.Kind, ID: last.ID})
		next = base64.RawURLEncoding.EncodeToString(b)
	}
	reply(c, 200, map[string]any{"items": rows, "next_cursor": next, "server_time": time.Now().UnixMilli()})
}
func (s *Service) momentInboxItem(ctx context.Context, c *app.RequestContext) {
	c.Header("Cache-Control", "private, no-store")
	agent, _ := agentID(c)
	kind := c.Param("kind")
	id, e := strconv.ParseInt(c.Param("source_id"), 10, 64)
	if e != nil || id <= 0 || !validMomentInboxKind(kind) {
		fail(c, 400, "INVALID_SOURCE", "消息标识无效", nil)
		return
	}
	rows, e := readMomentInbox(s.db.WithContext(ctx), agent, momentInboxCursor{}, kind, id)
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	if len(rows) != 1 {
		fail(c, 404, "MOMENT_SOURCE_UNAVAILABLE", "这条消息已不可访问", nil)
		return
	}
	if string(c.Method()) == "POST" {
		now := time.Now().UnixMilli()
		// INSERT SELECT rechecks visibility in the same statement (a block/removal
		// between the detail request and this request cannot authorize a receipt).
		result := s.db.WithContext(ctx).Exec(momentInboxSQL+`INSERT INTO moment_inbox_views(agent_id,source_kind,source_id,viewed_at)
 SELECT ?,kind,id,? FROM visible WHERE kind=? AND id=?
 ON CONFLICT(agent_id,source_kind,source_id) DO UPDATE SET viewed_at=EXCLUDED.viewed_at`, agent, agent, now, kind, id)
		if result.Error != nil {
			s.socialFailure(c, result.Error)
			return
		}
		if result.RowsAffected != 1 {
			fail(c, 404, "MOMENT_SOURCE_UNAVAILABLE", "这条消息已不可访问", nil)
			return
		}
		rows[0].ViewedAt = &now
	}
	reply(c, 200, map[string]any{"item": rows[0]})
}
