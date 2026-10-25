package consolev2

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"elsewhere_server/pkg/textguard"
	pmdal "elsewhere_server/rpc/pm/dal"
	"gorm.io/gorm"
)

// Managed automation never borrows an owner's session or creates friendships.
func managedMessagePermission(tx *gorm.DB, job managedJob, peer int64, reply bool) (bool, error) {
	column, setting := "dm_start_enabled", "auto_start_pm"
	if reply {
		column, setting = "dm_reply_enabled", "auto_reply_pm"
	}
	var allowed bool
	now := time.Now().UnixMilli()
	err := tx.Raw("SELECT EXISTS(SELECT 1 FROM managed_members m JOIN managed_campaigns c USING(sponsor_uid) JOIN agents a USING(agent_id) JOIN agent_settings g USING(agent_id) JOIN agents pa ON pa.agent_id=? WHERE m.agent_id=? AND m.sponsor_uid=? AND m.enabled AND m.deleted_at=0 AND a.identity_state='active' AND pa.identity_state='active' AND c.enabled AND c."+column+" AND g."+setting+" AND NOT EXISTS(SELECT 1 FROM user_relations WHERE rel_type=2 AND ((from_uid=m.agent_id AND to_uid=pa.agent_id) OR (to_uid=m.agent_id AND from_uid=pa.agent_id))) AND NOT EXISTS(SELECT 1 FROM console_v2_sessions cs JOIN managed_delegations d USING(session_id) WHERE cs.agent_id=m.agent_id AND cs.status='active' AND cs.idle_expires_at>? AND cs.absolute_expires_at>?) AND NOT EXISTS(SELECT 1 FROM agent_principals ap WHERE ap.agent_id=m.agent_id AND ap.status='active'))", peer, job.AgentID, job.SponsorUID, now, now).Scan(&allowed).Error
	return allowed && peer != job.AgentID, err
}

// Limits are shared by both ends of a pair, not independently by each sender.
func managedMessageLimit(tx *gorm.DB, job managedJob, peer int64, reply bool) (bool, error) {
	now := time.Now()
	local := now.UTC().Add(8 * time.Hour)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC).Add(-8 * time.Hour).UnixMilli()
	var counts struct{ Pair, Recent, Initiated int64 }
	err := tx.Raw(`SELECT count(*) FILTER(WHERE created_at>=?) AS pair,
 count(*) FILTER(WHERE created_at>?) AS recent,
 count(*) FILTER(WHERE created_at>=? AND sender_id=? AND trigger_key NOT LIKE 'message:%') AS initiated
 FROM managed_message_receipts WHERE decision='sent' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))`, midnight, now.Add(-30*time.Minute).UnixMilli(), midnight, job.AgentID, job.AgentID, peer, peer, job.AgentID).Scan(&counts).Error
	if err != nil {
		return false, err
	}
	if counts.Pair >= 4 || counts.Recent > 0 {
		return false, nil
	}
	if !reply {
		var n int64
		if err := tx.Raw(`SELECT count(*) FROM managed_message_receipts WHERE decision='sent' AND sender_id=? AND created_at>=? AND trigger_key NOT LIKE 'message:%'`, job.AgentID, midnight).Scan(&n).Error; err != nil {
			return false, err
		}
		if n >= 1 {
			return false, nil
		}
	}
	return true, nil
}

// An operator can select any active platform identity, independently of friendship.
// Existing threads are only continued after a real incoming message.
func (s *Service) managedExplicitMessageCandidate(tx *gorm.DB, job managedJob) (*managedMessageTarget, []managedThreadMessage, error) {
	peer := job.RecipientID
	lo, hi := job.AgentID, peer
	if lo > hi {
		lo, hi = hi, lo
	}
	var conv pmdal.Conversation
	if err := tx.Where("participant_a=? AND participant_b=? AND origin_id=0", lo, hi).Limit(1).Find(&conv).Error; err != nil {
		return nil, nil, err
	}
	reply := conv.ConvID > 0
	allowed, err := managedMessagePermission(tx, job, peer, reply)
	if err != nil || !allowed {
		return nil, nil, err
	}
	allowed, err = managedMessageLimit(tx, job, peer, reply)
	if err != nil || !allowed {
		return nil, nil, err
	}
	target := &managedMessageTarget{RecipientID: fmtRun(peer), TriggerKey: "operator:" + fmtRun(job.RunID)}
	if !reply {
		return target, nil, nil
	}
	if conv.Status != 0 || conv.TopicStatus != pmdal.TopicStatusOpen {
		return nil, nil, nil
	}
	var thread []managedThreadMessage
	if err := tx.Raw(`SELECT msg_id::text AS id,sender_id::text AS sender_id,left(content,300) AS content,created_at FROM private_messages WHERE conv_id=? ORDER BY msg_id DESC LIMIT 8`, conv.ConvID).Scan(&thread).Error; err != nil {
		return nil, nil, err
	}
	if len(thread) == 0 || thread[0].SenderID != fmtRun(peer) {
		return nil, nil, nil
	}
	target.ConversationID = fmtRun(conv.ConvID)
	target.ReplyToMessageID = thread[0].ID
	target.TriggerKey = "message:" + thread[0].ID
	for i, j := 0, len(thread)-1; i < j; i, j = i+1, j-1 {
		thread[i], thread[j] = thread[j], thread[i]
	}
	return target, thread, nil
}

func (s *Service) managedMessageCandidate(tx *gorm.DB, job managedJob) (*managedMessageTarget, []managedThreadMessage, error) {
	if job.RecipientID > 0 {
		return s.managedExplicitMessageCandidate(tx, job)
	}
	var rows []struct{ Peer, Conv, Msg int64 }
	err := tx.Raw(`SELECT pm.sender_id AS peer,pm.conv_id AS conv,pm.msg_id AS msg FROM private_messages pm
 JOIN conversations c USING(conv_id) JOIN agents peer ON peer.agent_id=pm.sender_id
 WHERE pm.receiver_id=? AND peer.identity_state='active' AND c.origin_type IN ('friend','direct','broadcast') AND c.status=0 AND c.topic_status=1 AND pm.created_at>?
 AND NOT EXISTS(SELECT 1 FROM private_messages newer WHERE newer.conv_id=pm.conv_id AND newer.msg_id>pm.msg_id)
 AND NOT EXISTS(SELECT 1 FROM managed_message_receipts r WHERE r.sender_id=? AND r.trigger_key=('message:'||pm.msg_id::text))
 ORDER BY pm.created_at DESC LIMIT 6`, job.AgentID, time.Now().Add(-7*24*time.Hour).UnixMilli(), job.AgentID).Scan(&rows).Error
	if err != nil {
		return nil, nil, err
	}
	for _, r := range rows {
		allowed, err := managedMessagePermission(tx, job, r.Peer, true)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			continue
		}
		allowed, err = managedMessageLimit(tx, job, r.Peer, true)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			continue
		}
		target := &managedMessageTarget{RecipientID: fmtRun(r.Peer), ConversationID: fmtRun(r.Conv), ReplyToMessageID: fmtRun(r.Msg), TriggerKey: "message:" + fmtRun(r.Msg)}
		var thread []managedThreadMessage
		err = tx.Raw(`SELECT msg_id::text AS id,sender_id::text AS sender_id,left(content,300) AS content,created_at FROM private_messages WHERE conv_id=? ORDER BY msg_id DESC LIMIT 8`, r.Conv).Scan(&thread).Error
		// Chronological context, bounded to this conversation only.
		for i, j := 0, len(thread)-1; i < j; i, j = i+1, j-1 {
			thread[i], thread[j] = thread[j], thread[i]
		}
		return target, thread, err
	}
	var starts []struct {
		Peer, Comment int64
		Content       string
	}
	err = tx.Raw(`SELECT c.agent_id AS peer,c.comment_id AS comment,left(c.content,160) AS content FROM social_work_comments c
 JOIN social_work_posts p USING(post_id) JOIN agents peer ON peer.agent_id=c.agent_id
 WHERE p.agent_id=? AND p.state='published' AND p.visibility='public' AND c.agent_id<>? AND peer.identity_state='active' AND c.created_at>?
 AND NOT EXISTS(SELECT 1 FROM managed_message_receipts r WHERE r.sender_id=? AND r.trigger_key=('comment:'||c.comment_id::text))
 ORDER BY c.created_at DESC LIMIT 6`, job.AgentID, job.AgentID, time.Now().Add(-7*24*time.Hour).UnixMilli(), job.AgentID).Scan(&starts).Error
	if err != nil {
		return nil, nil, err
	}
	for _, r := range starts {
		allowed, err := managedMessagePermission(tx, job, r.Peer, false)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			continue
		}
		allowed, err = managedMessageLimit(tx, job, r.Peer, false)
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			continue
		}
		lo, hi := job.AgentID, r.Peer
		if lo > hi {
			lo, hi = hi, lo
		}
		var convs []pmdal.Conversation
		if err := tx.Where("participant_a=? AND participant_b=? AND origin_id=0", lo, hi).Find(&convs).Error; err != nil {
			return nil, nil, err
		}
		// Existing conversations must be handled as replies. Never revive a closed thread.
		if len(convs) > 0 {
			continue
		}
		return &managedMessageTarget{RecipientID: fmtRun(r.Peer), TriggerCommentID: r.Comment, TriggerKey: "comment:" + fmtRun(r.Comment)}, []managedThreadMessage{{SenderID: fmtRun(r.Peer), Content: "公开评论：" + r.Content}}, nil
	}
	return nil, nil, nil
}

func (s *Service) commitManagedMessage(tx *gorm.DB, job managedJob, result managedModelResult) (int64, int64, string, error) {
	v := result.Value
	peer := socialDecimal(v.RecipientID)
	target, ok := result.Targets.Messages[peer]
	if !result.Targets.Enforced || !result.Targets.Private || !ok || v.ConversationID != target.ConversationID || v.ReplyToMessageID != target.ReplyToMessageID {
		return 0, 0, "", managedFailure("target")
	}
	reply := target.ReplyToMessageID != ""
	if err := pmdal.LockRelationPair(tx, job.AgentID, peer); err != nil {
		return 0, 0, "", err
	}
	if err := tx.Exec(`SELECT agent_id FROM managed_members WHERE agent_id=? FOR UPDATE`, peer).Error; err != nil {
		return 0, 0, "", err
	}
	if err := tx.Exec(`SELECT agent_id FROM agent_settings WHERE agent_id IN (?,?) ORDER BY agent_id FOR UPDATE`, job.AgentID, peer).Error; err != nil {
		return 0, 0, "", err
	}
	allowed, err := managedMessagePermission(tx, job, peer, reply)
	if err != nil {
		return 0, 0, "", err
	}
	if !allowed {
		return 0, 0, "私信权限或好友关系已变化，未发送", nil
	}
	allowed, err = managedMessageLimit(tx, job, peer, reply)
	if err != nil {
		return 0, 0, "", err
	}
	if !allowed {
		return 0, 0, "会话冷却或私信限额，未发送", nil
	}
	content := strings.TrimSpace(v.Content)
	if err := textguard.ValidateMessageContent(content); err != nil {
		return 0, 0, "", err
	}
	if socialSecretPattern.MatchString(content) || socialPrivatePattern.MatchString(content) || managedPrivatePattern.MatchString(content) || strings.Contains(content, "http") {
		return 0, 0, "", managedFailure("content_safety")
	}
	var duplicate bool
	if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_message_receipts WHERE sender_id=? AND trigger_key=?)`, job.AgentID, target.TriggerKey).Scan(&duplicate).Error; err != nil {
		return 0, 0, "", err
	}
	if duplicate {
		return 0, 0, "该消息已处理，未重复发送", nil
	}
	var recent []string
	if err := tx.Raw(`SELECT pm.content FROM managed_message_receipts r JOIN private_messages pm ON pm.msg_id=r.msg_id WHERE r.sender_id=? AND r.created_at>? ORDER BY r.created_at DESC LIMIT 20`, job.AgentID, time.Now().Add(-7*24*time.Hour).UnixMilli()).Scan(&recent).Error; err != nil {
		return 0, 0, "", err
	}
	for _, text := range recent {
		if managedNearText(content, text) {
			return 0, 0, "与近期私信内容重复，未发送", nil
		}
	}
	lo, hi := job.AgentID, peer
	if lo > hi {
		lo, hi = hi, lo
	}
	var conv pmdal.Conversation
	if reply {
		if err := tx.Raw(`SELECT * FROM conversations WHERE conv_id=? FOR UPDATE`, socialDecimal(target.ConversationID)).Scan(&conv).Error; err != nil {
			return 0, 0, "", err
		}
		if conv.ConvID == 0 || conv.ParticipantA != lo || conv.ParticipantB != hi || (conv.OriginType != "friend" && conv.OriginType != "direct" && conv.OriginType != "broadcast") || conv.Status != 0 || conv.TopicStatus != pmdal.TopicStatusOpen {
			return 0, 0, "会话已关闭或目标变化，未发送", nil
		}
		var latest struct {
			ID, Sender int64
			Actor      string
		}
		if err := tx.Raw(`SELECT msg_id AS id,sender_id AS sender,actor_kind AS actor FROM private_messages WHERE conv_id=? ORDER BY msg_id DESC LIMIT 1`, conv.ConvID).Scan(&latest).Error; err != nil {
			return 0, 0, "", err
		}
		if latest.ID != socialDecimal(target.ReplyToMessageID) || latest.Sender != peer {
			return 0, 0, "会话已有新消息，等待下轮", nil
		}
	} else {
		var valid bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM social_work_comments c JOIN social_work_posts p USING(post_id) WHERE c.comment_id=? AND c.agent_id=? AND p.agent_id=? AND p.state='published' AND p.visibility='public' AND c.created_at>?)`, target.TriggerCommentID, peer, job.AgentID, time.Now().Add(-7*24*time.Hour).UnixMilli()).Scan(&valid).Error; err != nil {
			return 0, 0, "", err
		}
		if strings.HasPrefix(target.TriggerKey, "operator:") {
			valid = job.RecipientID == peer && target.TriggerKey == "operator:"+fmtRun(job.RunID)
		}
		if !valid {
			return 0, 0, "公开互动已不可用，未发起私信", nil
		}
		var n int64
		if err := tx.Model(&pmdal.Conversation{}).Where("participant_a=? AND participant_b=? AND origin_id=0", lo, hi).Count(&n).Error; err != nil {
			return 0, 0, "", err
		}
		if n > 0 {
			return 0, 0, "已有会话，等待新来信", nil
		}
		id, err := s.idgen.NextID()
		if err != nil {
			return 0, 0, "", err
		}
		var names []struct {
			AgentID   int64
			AgentName string
		}
		if err := tx.Raw(`SELECT agent_id,agent_name FROM agents WHERE agent_id IN (?,?)`, lo, hi).Scan(&names).Error; err != nil {
			return 0, 0, "", err
		}
		byID := map[int64]string{}
		for _, n := range names {
			byID[n.AgentID] = n.AgentName
		}
		origin := "direct"
		friend, e := pmdal.IsFriend(tx, job.AgentID, peer)
		if e != nil {
			return 0, 0, "", e
		}
		if friend {
			origin = "friend"
		}
		conv = pmdal.Conversation{ConvID: id, ParticipantA: lo, ParticipantB: hi, ParticipantAName: byID[lo], ParticipantBName: byID[hi], InitiatorID: job.AgentID, OriginType: origin, TopicStatus: pmdal.TopicStatusOpen}
		if err := pmdal.CreateConversation(tx, &conv); err != nil {
			return 0, 0, "", err
		}
	}
	data := map[string]string{"content": content}
	if reply {
		data["conv_id"] = fmtRun(conv.ConvID)
	} else {
		data["receiver_id"] = fmtRun(peer)
	}
	raw, _ := json.Marshal(data)
	child := *s
	child.db = tx
	child.redisClient = nil // The durable outbox notifies after commit.
	receipt, err := child.activityTool(context.Background(), job.AgentID, "message", activityRequest{Key: "managed:" + fmtRun(job.RunID) + ":message", Data: raw})
	if err != nil {
		return 0, 0, "", err
	}
	msgID := socialDecimal(activityString(activityData(receipt), "msg_id"))
	if receipt.Status != 200 || msgID == 0 {
		return 0, 0, "", managedFailure("publication")
	}
	if err := tx.Exec(`INSERT INTO managed_message_receipts(run_id,sender_id,receiver_id,conv_id,msg_id,trigger_key,created_at) VALUES(?,?,?,?,?,?,?)`, job.RunID, job.AgentID, peer, conv.ConvID, msgID, target.TriggerKey, time.Now().UnixMilli()).Error; err != nil {
		return 0, 0, "", err
	}
	return msgID, conv.ConvID, "", nil
}

// Atomic Redis delivery deduplicates retries after a DB-commit/notification gap.
// The DB outbox persists across process restarts; it never re-sends message content.
const managedMessageNotifyScript = `
if redis.call('EXISTS',KEYS[1])==1 then return 1 end
redis.call('DEL',KEYS[2])
redis.call('PUBLISH',KEYS[3],ARGV[1])
redis.call('XADD','stream:agent:activity','*','agent_id',ARGV[2],'event_type','message_received','summary','Received a private message')
redis.call('XADD','stream:agent:activity','*','agent_id',ARGV[3],'event_type','message_sent','summary','Sent a private message')
redis.call('SET',KEYS[1],'1')
return 1`

func (s *Service) notifyManagedMessages(ctx context.Context) error {
	if s.redisClient == nil {
		return nil
	}
	var rows []struct{ RunID, MsgID, ReceiverID, SenderID int64 }
	if err := s.db.WithContext(ctx).Raw(`SELECT run_id,msg_id,receiver_id,sender_id FROM managed_message_receipts WHERE msg_id IS NOT NULL AND notified_at IS NULL AND next_notify_at<=? ORDER BY created_at LIMIT 20`, time.Now().UnixMilli()).Scan(&rows).Error; err != nil {
		return err
	}
	for _, r := range rows {
		err := s.redisClient.Eval(ctx, managedMessageNotifyScript, []string{fmt.Sprintf("managed:notify:%d", r.MsgID), fmt.Sprintf("pm:fetch:%d", r.ReceiverID), fmt.Sprintf("pm:push:%d", r.ReceiverID)}, fmtRun(r.MsgID), fmtRun(r.ReceiverID), fmtRun(r.SenderID)).Err()
		if err != nil {
			if e := s.db.WithContext(ctx).Exec(`UPDATE managed_message_receipts SET notify_attempts=notify_attempts+1,next_notify_at=? WHERE run_id=? AND notified_at IS NULL`, time.Now().Add(time.Minute).UnixMilli(), r.RunID).Error; e != nil {
				return e
			}
			continue
		}
		if err := s.db.WithContext(ctx).Exec(`UPDATE managed_message_receipts SET notified_at=?,notify_attempts=notify_attempts+1 WHERE run_id=? AND notified_at IS NULL`, time.Now().UnixMilli(), r.RunID).Error; err != nil {
			return err
		}
	}
	return nil
}
