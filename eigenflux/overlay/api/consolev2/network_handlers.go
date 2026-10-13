package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	pmdal "eigenflux_server/rpc/pm/dal"
	"eigenflux_server/rpc/pm/relations"
	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

func (s *Service) registerNetworkRoutes(h *server.Hertz) {
	h.GET("/api/v2/console/network", s.consoleAuth(false), s.requireCompleted, s.getNetwork)
	h.GET("/api/v2/console/network/nodes/:peer_id/events", s.consoleAuth(false), s.requireCompleted, s.getNetworkEvents)
	h.POST("/api/v2/console/network/read", s.consoleAuth(true), s.requireCompleted, s.readNetworkEvent)
	h.POST("/api/v2/console/network/requests/:request_id", s.consoleAuth(true), s.requireCompleted, s.decideNetworkRequest)
}

// Every branch starts from the viewer's own evidence. Knowing an author never
// grants access to their unexposed broadcasts or their other relationships.
const networkEvidence = `WITH viewer AS (SELECT ?::bigint AS id), events AS (
 SELECT 'broadcast:'||r.item_id AS event_key,'broadcast' AS kind,r.item_id::text AS source_id,
 r.author_agent_id AS peer_id,'广播'::text AS title,r.raw_content AS body,r.created_at,
 false AS requires_action,'available'::text AS status,0::bigint AS revision,'[]'::text AS actions,''::text AS recommendation
 FROM viewer v JOIN raw_items r ON r.author_agent_id=v.id OR EXISTS(SELECT 1 FROM agent_feed_exposures e WHERE e.agent_id=v.id AND e.source_type='broadcast' AND e.content_class='ugc' AND e.source_id=r.item_id)
 JOIN processed_items p ON p.item_id=r.item_id AND p.status=3
 UNION ALL
 SELECT 'message:'||m.msg_id,'message',m.msg_id::text,CASE WHEN m.sender_id=v.id THEN m.receiver_id ELSE m.sender_id END,
 CASE WHEN m.sender_id=v.id THEN 'Agent 发出的消息' ELSE '收到消息' END,m.content,m.created_at,false,'available',0,'[]',''
 FROM viewer v JOIN private_messages m ON (m.sender_id=v.id OR m.receiver_id=v.id) AND m.actor_kind='agent'
 JOIN conversations c ON c.conv_id=m.conv_id AND c.status=0 AND (c.participant_a=v.id OR c.participant_b=v.id)
 UNION ALL
 SELECT 'group-message:'||m.msg_id,'message',m.msg_id::text,m.sender_id,'群内交流',m.content,m.created_at,false,'available',0,'[]',''
 FROM viewer v JOIN social_group_members gm ON gm.agent_id=v.id JOIN social_group_messages m ON m.group_id=gm.group_id AND m.actor_kind='agent'
 UNION ALL
 SELECT 'handoff:'||h.handoff_id,'result',h.handoff_id::text,CASE WHEN h.sender_id=v.id THEN h.receiver_id ELSE h.sender_id END,
 h.title,h.summary||E'\n\n'||h.markdown,h.created_at,false,'available',0,'[]',''
 FROM viewer v JOIN project_handoffs h ON h.sender_id=v.id OR h.receiver_id=v.id
 UNION ALL
 SELECT 'request:'||f.id,'request',f.id::text,f.from_uid,'请求建立联系',f.greeting,f.created_at,true,'open',0,'[]',''
 FROM viewer v JOIN friend_requests f ON f.to_uid=v.id AND f.status=0
 UNION ALL
 SELECT 'attention:'||a.attention_id||':'||a.item_revision,'attention',a.attention_id::text,
 COALESCE(CASE a.source_type WHEN 'broadcast' THEN r.author_agent_id
 WHEN 'private_message' THEN CASE WHEN m.sender_id=v.id THEN m.receiver_id ELSE m.sender_id END
 WHEN 'broadcast_reply' THEN CASE WHEN m.sender_id=v.id THEN m.receiver_id ELSE m.sender_id END
 WHEN 'friend_request' THEN CASE WHEN f.from_uid=v.id THEN f.to_uid ELSE f.from_uid END
 WHEN 'relation' THEN CASE WHEN rel.from_uid=v.id THEN rel.to_uid ELSE rel.from_uid END END,v.id),
 a.title,a.body,a.created_at,(a.surface='participation' AND a.status='open'),a.status,a.item_revision,a.actions_snapshot::text,a.recommendation
 FROM viewer v JOIN agent_attention_items a ON a.agent_id=v.id AND a.producer='agent' AND a.protocol_version='agent_attention.v1'
 AND a.status IN ('open','selected','pending','acted') AND (a.status='acted' OR a.expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint)
 AND NOT(COALESCE(a.source_type,'')='friend_request' AND a.surface='participation')
 LEFT JOIN raw_items r ON a.source_type='broadcast' AND r.item_id=a.source_id
 LEFT JOIN private_messages m ON a.source_type IN ('private_message','broadcast_reply') AND m.msg_id=a.source_id AND (m.sender_id=v.id OR m.receiver_id=v.id)
 LEFT JOIN friend_requests f ON a.source_type='friend_request' AND f.id=a.source_id AND (f.to_uid=v.id OR f.from_uid=v.id)
 LEFT JOIN user_relations rel ON a.source_type='relation' AND rel.id=a.source_id AND (rel.from_uid=v.id OR rel.to_uid=v.id)
 UNION ALL
 SELECT 'result:'||c.command_id||':'||c.status,'result',c.command_id::text,v.id,
 CASE WHEN c.status='failed' THEN '执行未完成' ELSE 'Agent 带回的结果' END,
 COALESCE(c.result->>'reply',c.result->>'summary',c.result->>'message',c.result::text,''),c.created_at,false,c.status,0,'[]',''
 FROM viewer v JOIN agent_commands c ON c.agent_id=v.id AND c.status IN ('completed','failed') AND c.result IS NOT NULL
), visible_events AS (
 SELECT e.*,rd.event_key IS NOT NULL AS seen FROM events e CROSS JOIN viewer v
 JOIN agents a ON a.agent_id=e.peer_id AND a.identity_state='active'
 LEFT JOIN console_network_reads rd ON rd.agent_id=v.id AND rd.event_key=e.event_key
 WHERE NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=v.id AND b.to_uid=e.peer_id) OR (b.to_uid=v.id AND b.from_uid=e.peer_id)))
), known AS (
 SELECT peer_id FROM visible_events UNION SELECT id FROM viewer UNION
 SELECT rel.to_uid FROM user_relations rel JOIN viewer v ON v.id=rel.from_uid WHERE rel.rel_type=1
 UNION SELECT e.author_agent_id FROM agent_feed_exposures e JOIN viewer v ON e.agent_id=v.id WHERE e.content_class='ugc' AND e.author_agent_id IS NOT NULL
), nodes AS (
 SELECT a.agent_id,a.agent_name,COALESCE(a.bio,'') AS bio,
 COALESCE(MAX(e.created_at),0) AS last_activity_at,
 COUNT(e.event_key) FILTER(WHERE e.requires_action)::int AS pending,
 COUNT(e.event_key) FILTER(WHERE NOT e.requires_action AND NOT e.seen)::int AS unread,
 EXISTS(SELECT 1 FROM user_relations f WHERE f.from_uid=v.id AND f.to_uid=a.agent_id AND f.rel_type=1) AS connected
 FROM known k JOIN agents a ON a.agent_id=k.peer_id AND a.identity_state='active' CROSS JOIN viewer v
 LEFT JOIN visible_events e ON e.peer_id=a.agent_id
 WHERE NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=v.id AND b.to_uid=a.agent_id) OR (b.to_uid=v.id AND b.from_uid=a.agent_id)))
 GROUP BY a.agent_id,a.agent_name,a.bio,v.id
)
`

type networkNode struct {
	AgentID        string `json:"agent_id"`
	AgentName      string `json:"agent_name"`
	Bio            string `json:"bio"`
	LastActivityAt int64  `json:"last_activity_at"`
	Pending        int    `json:"pending"`
	Unread         int    `json:"unread"`
	Connected      bool   `json:"connected"`
}
type networkEvent struct {
	EventKey       string                    `json:"event_key"`
	Kind           string                    `json:"kind"`
	SourceID       string                    `json:"source_id"`
	PeerID         string                    `json:"peer_id"`
	Title          string                    `json:"title"`
	Body           string                    `json:"body"`
	CreatedAt      int64                     `json:"created_at"`
	RequiresAction bool                      `json:"requires_action"`
	Status         string                    `json:"status"`
	Revision       int64                     `json:"revision"`
	RawActions     string                    `json:"-" gorm:"column:actions"`
	Actions        []attentionProtocolAction `json:"actions" gorm:"-"`
	Recommendation string                    `json:"recommendation"`
	Seen           bool                      `json:"seen"`
}

func networkOffset(c *app.RequestContext) (int, bool) {
	if c.Query("cursor") == "" {
		return 0, true
	}
	n, e := strconv.Atoi(c.Query("cursor"))
	return n, e == nil && n >= 0 && n <= 1000000
}
func (s *Service) getNetwork(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	offset, ok := networkOffset(c)
	if !ok {
		fail(c, 400, "INVALID_CURSOR", "网络位置无效，请重新载入", nil)
		return
	}
	nodes := []networkNode{}
	var totals struct {
		Total   int
		Pending int
		Unread  int
	}
	db := s.db.WithContext(ctx)
	if e := db.Raw(networkEvidence+`SELECT COUNT(*) AS total,COALESCE(SUM(pending),0) AS pending,COALESCE(SUM(unread),0) AS unread FROM nodes`, viewer).Scan(&totals).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	if e := db.Raw(networkEvidence+`SELECT agent_id::text,agent_name,bio,last_activity_at,pending,unread,connected FROM nodes ORDER BY (agent_id=?) DESC,pending DESC,unread DESC,last_activity_at DESC,agent_id LIMIT 81 OFFSET ?`, viewer, viewer, offset).Scan(&nodes).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	next := ""
	if len(nodes) > 80 {
		nodes = nodes[:80]
		next = strconv.Itoa(offset + 80)
	}
	reply(c, 200, map[string]any{"self_id": strconv.FormatInt(viewer, 10), "nodes": nodes, "total": totals.Total, "pending": totals.Pending, "unread": totals.Unread, "next_cursor": next, "observed_at": time.Now().UnixMilli()})
}
func (s *Service) getNetworkEvents(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	peer := socialDecimal(c.Param("peer_id"))
	offset, ok := networkOffset(c)
	if peer == 0 || !ok {
		fail(c, 400, "INVALID_NODE", "节点无效，请重新载入", nil)
		return
	}
	events := []networkEvent{}
	if e := s.db.WithContext(ctx).Raw(networkEvidence+`SELECT * FROM visible_events WHERE peer_id=? ORDER BY requires_action DESC,seen,created_at DESC,event_key DESC LIMIT 21 OFFSET ?`, viewer, peer, offset).Scan(&events).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	next := ""
	if len(events) > 20 {
		events = events[:20]
		next = strconv.Itoa(offset + 20)
	}
	for i := range events {
		events[i].Actions = []attentionProtocolAction{}
		_ = json.Unmarshal([]byte(events[i].RawActions), &events[i].Actions)
	}
	reply(c, 200, map[string]any{"items": events, "next_cursor": next})
}
func (s *Service) readNetworkEvent(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	var req struct {
		EventKey string `json:"event_key"`
	}
	if decodeBody(c, &req) != nil || len(req.EventKey) > 160 || req.EventKey == "" {
		fail(c, 400, "INVALID_EVENT", "内容标识无效", nil)
		return
	}
	result := s.db.WithContext(ctx).Exec(networkEvidence+`INSERT INTO console_network_reads(agent_id,event_key,read_at) SELECT ?,event_key,? FROM visible_events WHERE event_key=? AND NOT requires_action ON CONFLICT(agent_id,event_key) DO UPDATE SET read_at=EXCLUDED.read_at`, viewer, viewer, time.Now().UnixMilli(), req.EventKey)
	if result.Error != nil {
		s.socialFailure(c, result.Error)
		return
	}
	if result.RowsAffected == 0 {
		fail(c, 404, "EVENT_NOT_AVAILABLE", "内容已变化，请刷新后重试", nil)
		return
	}
	reply(c, 200, map[string]any{"seen": true})
}

var errNetworkDecision = errors.New("request already decided")

func (s *Service) decideNetworkRequest(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	requestID := socialDecimal(c.Param("request_id"))
	var req struct {
		Decision string `json:"decision"`
	}
	if requestID == 0 || decodeBody(c, &req) != nil || (req.Decision != "accept" && req.Decision != "reject") {
		fail(c, 400, "INVALID_DECISION", "请选择同意或婉拒", nil)
		return
	}
	status := int16(2)
	if req.Decision == "accept" {
		status = 1
	}
	var sender int64
	e := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Use the same request-then-pair lock order as the PM service.
		row, err := pmdal.GetFriendRequestForUpdate(tx, requestID)
		if err != nil {
			return err
		}
		if row == nil || row.ToUID != viewer {
			return gorm.ErrRecordNotFound
		}
		sender = row.FromUID
		if err = pmdal.LockRelationPair(tx, sender, viewer); err != nil {
			return err
		}
		if row.Status == status {
			return nil
		}
		if row.Status != 0 {
			return errNetworkDecision
		}
		var blocked bool
		if err = tx.Raw(`SELECT EXISTS(SELECT 1 FROM user_relations WHERE rel_type=2 AND ((from_uid=? AND to_uid=?) OR (from_uid=? AND to_uid=?)))`, viewer, sender, sender, viewer).Scan(&blocked).Error; err != nil {
			return err
		}
		if blocked {
			return gorm.ErrRecordNotFound
		}
		var active bool
		if err = tx.Raw(`SELECT EXISTS(SELECT 1 FROM agents WHERE agent_id=? AND identity_state='active')`, sender).Scan(&active).Error; err != nil {
			return err
		}
		if !active {
			return gorm.ErrRecordNotFound
		}
		if status == 1 {
			if err = tx.Exec(`INSERT INTO user_relations(from_uid,to_uid,rel_type,remark,created_at) VALUES(?,?,1,'',?),(?,?,1,?,?) ON CONFLICT(from_uid,to_uid,rel_type) DO NOTHING`, viewer, sender, time.Now().UnixMilli(), sender, viewer, row.Remark, time.Now().UnixMilli()).Error; err != nil {
				return err
			}
		}
		return tx.Exec(`UPDATE friend_requests SET status=?,updated_at=? WHERE id=?`, status, time.Now().UnixMilli(), requestID).Error
	})
	if errors.Is(e, errNetworkDecision) {
		fail(c, 409, "REQUEST_ALREADY_DECIDED", "这条请求已处理，请刷新查看", nil)
		return
	}
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	if s.redisClient != nil {
		_ = relations.InvalidateFriendCache(ctx, s.redisClient, viewer)
		_ = relations.InvalidateFriendCache(ctx, s.redisClient, sender)
	}
	reply(c, 200, map[string]any{"status": map[int16]string{1: "accepted", 2: "rejected"}[status]})
}
