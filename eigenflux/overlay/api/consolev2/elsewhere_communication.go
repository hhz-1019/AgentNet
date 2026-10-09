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
	"github.com/cloudwego/hertz/pkg/app/server"
	"gorm.io/gorm"
)

func (s *Service) registerElsewhereCommunication(h *server.Hertz) {
	h.POST("/api/v2/console/pm/send", s.consoleAuth(true), s.requireCompleted, s.sendHumanPM)
	for _, p := range []string{"/api/v2/console/groups", "/api/v2/communication/groups"} {
		read, write := s.consoleAuth(false), s.consoleAuth(true)
		if strings.Contains(p, "communication") {
			read = s.agentAuth("communication:read")
			write = s.agentAuth("communication:write")
		}
		h.GET(p, read, s.requireCompleted, s.listGroups)
		h.POST(p, write, s.requireCompleted, s.createGroup)
		h.GET(p+"/:group_id/messages", read, s.requireCompleted, s.groupMessages)
		h.POST(p+"/:group_id/messages", write, s.requireCompleted, s.sendGroupMessage)
	}
}
func canCommunicate(tx *gorm.DB, a, b int64, friend bool) error {
	var allowed bool
	q := `SELECT EXISTS(SELECT 1 FROM agents WHERE agent_id=? AND NOT EXISTS(SELECT 1 FROM user_relations WHERE rel_type=2 AND ((from_uid=? AND to_uid=?) OR (to_uid=? AND from_uid=?))))`
	args := []any{b, a, b, a, b}
	if friend {
		q += ` AND EXISTS(SELECT 1 FROM user_relations WHERE from_uid=? AND to_uid=? AND rel_type=1)`
		args = append(args, a, b)
	}
	if e := tx.Raw(q, args...).Scan(&allowed).Error; e != nil {
		return e
	}
	if !allowed || a == b {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (s *Service) sendHumanPM(ctx context.Context, c *app.RequestContext) {
	_, viewer, ok := s.twinOwner(c)
	if !ok {
		return
	}
	var req struct {
		ConvID     string `json:"conv_id"`
		ReceiverID string `json:"receiver_id"`
		Content    string `json:"content"`
		Key        string `json:"idempotency_key"`
	}
	if decodeBody(c, &req) != nil || strings.TrimSpace(req.Content) == "" || utf8.RuneCountInString(req.Content) > 10000 {
		fail(c, 400, "INVALID_MESSAGE", "消息需为 1–10000 字", nil)
		return
	}
	var conv, peer int64
	msg, e := s.elsewhereOperation(ctx, viewer, "pm:"+req.Key, req, func(tx *gorm.DB, id int64) error {
		conv = socialDecimal(req.ConvID)
		peer = socialDecimal(req.ReceiverID)
		if conv != 0 {
			var row struct {
				ParticipantA int64
				ParticipantB int64
				OriginType   string
			}
			if e := tx.Raw(`SELECT participant_a,participant_b,origin_type FROM conversations WHERE conv_id=? AND status=0 AND (participant_a=? OR participant_b=?) FOR UPDATE`, conv, viewer, viewer).Scan(&row).Error; e != nil {
				return e
			}
			if row.ParticipantA == 0 {
				return gorm.ErrRecordNotFound
			}
			peer = row.ParticipantA
			if peer == viewer {
				peer = row.ParticipantB
			}
			if e := canCommunicate(tx, viewer, peer, row.OriginType == "friend"); e != nil {
				return e
			}
		} else {
			if e := canCommunicate(tx, viewer, peer, true); e != nil {
				return e
			}
			a, b := viewer, peer
			if a > b {
				a, b = b, a
			}
			next, e := s.idgen.NextID()
			if e != nil {
				return e
			}
			if e = tx.Exec(`INSERT INTO conversations(conv_id,participant_a,participant_b,initiator_id,last_sender_id,origin_type,origin_id,msg_count,status,updated_at,participant_a_name,participant_b_name) SELECT ?,?,?,?,?,'friend',0,0,0,?,a.agent_name,b.agent_name FROM agents a,agents b WHERE a.agent_id=? AND b.agent_id=? ON CONFLICT(participant_a,participant_b,origin_id) DO NOTHING`, next, a, b, viewer, viewer, time.Now().UnixMilli(), a, b).Error; e != nil {
				return e
			}
			if e = tx.Raw(`SELECT conv_id FROM conversations WHERE participant_a=? AND participant_b=? AND origin_id=0 AND status=0 FOR UPDATE`, a, b).Scan(&conv).Error; e != nil {
				return e
			}
			if conv == 0 {
				return gorm.ErrRecordNotFound
			}
		}
		now := time.Now().UnixMilli()
		if e := tx.Exec(`INSERT INTO private_messages(msg_id,conv_id,sender_id,receiver_id,content,is_read,created_at,sender_name,receiver_name,actor_kind) SELECT ?,?,?,?,?,false,?,a.agent_name,b.agent_name,'human' FROM agents a,agents b WHERE a.agent_id=? AND b.agent_id=?`, id, conv, viewer, peer, strings.TrimSpace(req.Content), now, viewer, peer).Error; e != nil {
			return e
		}
		return tx.Exec(`UPDATE conversations SET msg_count=msg_count+1,last_sender_id=?,updated_at=? WHERE conv_id=?`, viewer, now, conv).Error
	})
	if e != nil {
		s.elsewhereFailure(c, e)
		return
	}
	// Resolve committed data on retries, too. Legacy PM fetch sees the same row.
	var result struct {
		ConvID     int64
		ReceiverID int64
	}
	if e = s.db.Raw(`SELECT conv_id,receiver_id FROM private_messages WHERE msg_id=? AND sender_id=?`, msg, viewer).Scan(&result).Error; e != nil {
		s.socialFailure(c, e)
		return
	}
	if s.redisClient != nil {
		s.redisClient.Del(ctx, fmt.Sprintf("pm:fetch:%d", result.ReceiverID))
		s.redisClient.Publish(ctx, fmt.Sprintf("pm:push:%d", result.ReceiverID), strconv.FormatInt(msg, 10))
	}
	reply(c, 201, map[string]any{"msg_id": strconv.FormatInt(msg, 10), "conv_id": strconv.FormatInt(result.ConvID, 10), "actor_kind": "human"})
}
func (s *Service) createGroup(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	if strings.Contains(string(c.Path()), "/console/") {
		if _, _, ok := s.twinOwner(c); !ok {
			return
		}
	}
	var req struct {
		Name    string   `json:"name"`
		Members []string `json:"members"`
		Key     string   `json:"idempotency_key"`
	}
	if decodeBody(c, &req) != nil || strings.TrimSpace(req.Name) == "" || utf8.RuneCountInString(req.Name) > 80 || len(req.Members) < 1 || len(req.Members) > 49 {
		fail(c, 400, "INVALID_GROUP", "请填写群名并选择 1–49 位联系人", nil)
		return
	}
	id, e := s.elsewhereOperation(ctx, viewer, "group:"+req.Key, req, func(tx *gorm.DB, id int64) error {
		seen := map[int64]bool{viewer: true}
		members := []int64{viewer}
		for _, raw := range req.Members {
			m := socialDecimal(raw)
			if seen[m] {
				continue
			}
			if e := canCommunicate(tx, viewer, m, true); e != nil {
				return e
			}
			seen[m] = true
			members = append(members, m)
		}
		if len(members) < 2 {
			return gorm.ErrRecordNotFound
		}
		now := time.Now().UnixMilli()
		if e := tx.Exec(`INSERT INTO social_groups VALUES(?,?,?,?,?)`, id, strings.TrimSpace(req.Name), viewer, now, now).Error; e != nil {
			return e
		}
		for _, m := range members {
			if e := tx.Exec(`INSERT INTO social_group_members(group_id,agent_id) VALUES(?,?)`, id, m).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		s.elsewhereFailure(c, e)
		return
	}
	reply(c, 201, map[string]any{"group_id": strconv.FormatInt(id, 10)})
}
func (s *Service) listGroups(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	cursor := socialDecimal(c.Query("cursor"))
	var rows []struct {
		GroupID   int64
		Name      string
		UpdatedAt int64
		Unread    int64
		Members   string
	}
	e := s.db.WithContext(ctx).Raw(`SELECT g.group_id,g.name,g.updated_at,(SELECT count(*) FROM social_group_messages x WHERE x.group_id=g.group_id AND x.msg_id>m.read_message_id AND x.sender_id<>? AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=x.sender_id) OR (b.to_uid=? AND b.from_uid=x.sender_id)))) AS unread,(SELECT json_agg(json_build_object('id',a.agent_id::text,'name',a.agent_name) ORDER BY a.agent_id)::text FROM social_group_members gm JOIN agents a ON a.agent_id=gm.agent_id WHERE gm.group_id=g.group_id) AS members FROM social_groups g JOIN social_group_members m ON m.group_id=g.group_id AND m.agent_id=? WHERE (?=0 OR g.group_id<?) ORDER BY g.group_id DESC LIMIT 51`, viewer, viewer, viewer, viewer, cursor, cursor).Scan(&rows).Error
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	next := ""
	if len(rows) > 50 {
		rows = rows[:50]
		next = strconv.FormatInt(rows[49].GroupID, 10)
	}
	items := []map[string]any{}
	for _, r := range rows {
		items = append(items, map[string]any{"group_id": strconv.FormatInt(r.GroupID, 10), "name": r.Name, "updated_at": r.UpdatedAt, "unread_count": r.Unread, "members": json.RawMessage(r.Members)})
	}
	reply(c, 200, map[string]any{"items": items, "next_cursor": next})
}
func groupMember(tx *gorm.DB, viewer, group int64) error {
	var valid bool
	if e := tx.Raw(`SELECT EXISTS(SELECT 1 FROM social_group_members WHERE group_id=? AND agent_id=?)`, group, viewer).Scan(&valid).Error; e != nil {
		return e
	}
	if !valid {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (s *Service) groupMessages(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	group := socialDecimal(c.Param("group_id"))
	if e := groupMember(s.db, viewer, group); e != nil {
		s.elsewhereFailure(c, e)
		return
	}
	cursor := socialDecimal(c.Query("cursor"))
	var rows []struct {
		MsgID      int64
		SenderID   int64
		SenderName string
		ActorKind  string
		Content    string
		CreatedAt  int64
	}
	e := s.db.WithContext(ctx).Raw(`SELECT m.*,a.agent_name AS sender_name FROM social_group_messages m JOIN agents a ON a.agent_id=m.sender_id WHERE group_id=? AND (?=0 OR msg_id<?) AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=m.sender_id) OR (b.to_uid=? AND b.from_uid=m.sender_id))) ORDER BY msg_id DESC LIMIT 51`, group, cursor, cursor, viewer, viewer).Scan(&rows).Error
	if e != nil {
		s.socialFailure(c, e)
		return
	}
	next := ""
	if len(rows) > 50 {
		rows = rows[:50]
		next = strconv.FormatInt(rows[49].MsgID, 10)
	}
	if cursor == 0 && len(rows) > 0 {
		if e = s.db.Exec(`UPDATE social_group_members SET read_message_id=GREATEST(read_message_id,?) WHERE group_id=? AND agent_id=?`, rows[0].MsgID, group, viewer).Error; e != nil {
			s.socialFailure(c, e)
			return
		}
	}
	items := []map[string]any{}
	for _, r := range rows {
		items = append(items, map[string]any{"msg_id": strconv.FormatInt(r.MsgID, 10), "sender_agent_id": strconv.FormatInt(r.SenderID, 10), "sender_name": r.SenderName, "actor_kind": r.ActorKind, "content": r.Content, "created_at": r.CreatedAt})
	}
	reply(c, 200, map[string]any{"messages": items, "next_cursor": next})
}
func (s *Service) sendGroupMessage(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	group := socialDecimal(c.Param("group_id"))
	actor := "agent"
	if strings.Contains(string(c.Path()), "/console/") {
		if _, _, ok := s.twinOwner(c); !ok {
			return
		}
		actor = "human"
	}
	var req struct {
		Content string `json:"content"`
		Key     string `json:"idempotency_key"`
	}
	if decodeBody(c, &req) != nil || strings.TrimSpace(req.Content) == "" || utf8.RuneCountInString(req.Content) > 10000 {
		fail(c, 400, "INVALID_MESSAGE", "消息需为 1–10000 字", nil)
		return
	}
	id, e := s.elsewhereOperation(ctx, viewer, "group-message:"+req.Key, []string{strconv.FormatInt(group, 10), actor, req.Content}, func(tx *gorm.DB, id int64) error {
		if e := groupMember(tx, viewer, group); e != nil {
			return e
		}
		now := time.Now().UnixMilli()
		if e := tx.Exec(`INSERT INTO social_group_messages VALUES(?,?,?,?,?,?)`, id, group, viewer, actor, strings.TrimSpace(req.Content), now).Error; e != nil {
			return e
		}
		return tx.Exec(`UPDATE social_groups SET updated_at=? WHERE group_id=?`, now, group).Error
	})
	if e != nil {
		s.elsewhereFailure(c, e)
		return
	}
	reply(c, 201, map[string]any{"msg_id": strconv.FormatInt(id, 10), "actor_kind": actor})
}
