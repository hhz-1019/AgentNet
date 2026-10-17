package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"eigenflux_server/pkg/textguard"
	pmdal "eigenflux_server/rpc/pm/dal"
	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Only system identities gain a non-friend contact entry. Other user-to-user
// conversations keep their existing API and relationship policy.
func managedInboxPair(tx *gorm.DB, a, b int64) (bool, error) {
	var ok bool
	err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_members m JOIN agents a USING(agent_id) WHERE m.agent_id IN (?,?) AND m.deleted_at=0 AND a.identity_state='active')`, a, b).Scan(&ok).Error
	return ok, err
}

func managedInboxOrigin(tx *gorm.DB, a, b int64) (string, error) {
	friend, err := pmdal.IsFriend(tx, a, b)
	if err != nil {
		return "", err
	}
	if friend {
		return "friend", nil
	}
	allowed, err := managedInboxPair(tx, a, b)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", gorm.ErrRecordNotFound
	}
	return "direct", nil
}

// Count from the message store so every system contact path shares the same
// non-friend waiting window, including messages received through the web UI.
func managedInboxWindow(tx *gorm.DB, conv, a, b int64) error {
	friend, err := pmdal.IsFriend(tx, a, b)
	if err != nil {
		return err
	}
	if friend {
		return nil
	}
	var count int64
	err = tx.Raw(`SELECT count(*) FROM private_messages WHERE conv_id=? AND sender_id=? AND created_at>? AND msg_id>COALESCE((SELECT max(msg_id) FROM private_messages WHERE conv_id=? AND sender_id=?),0)`, conv, a, time.Now().Add(-24*time.Hour).UnixMilli(), conv, b).Scan(&count).Error
	if err != nil {
		return err
	}
	if count >= 3 {
		return errors.New("PM_WAITING_FOR_PEER_REPLY")
	}
	return nil
}

// Called before the normal RPC handler only when its target is a managed inbox.
// Agent permission has already been checked by agentMessagePermission.
func (s *Service) tryManagedInboxAgent(ctx context.Context, c *app.RequestContext) bool {
	return s.sendLocalAgentPM(ctx, c, true)
}
func (s *Service) sendLocalAgentPM(ctx context.Context, c *app.RequestContext, managedOnly bool) bool {
	viewer, _ := agentID(c)
	var req struct {
		ReceiverID string `json:"receiver_id"`
		ConvID     string `json:"conv_id"`
		ItemID     string `json:"item_id"`
		Content    string `json:"content"`
	}
	body, err := c.Body()
	if err != nil || json.Unmarshal(body, &req) != nil {
		return false
	}
	// Broadcast entry points retain their existing item visibility/no-reply checks.
	if req.ItemID != "" {
		return false
	}
	peer, conv := socialDecimal(req.ReceiverID), socialDecimal(req.ConvID)
	if conv > 0 {
		var pair struct{ ParticipantA, ParticipantB int64 }
		if err := s.db.Raw(`SELECT participant_a,participant_b FROM conversations WHERE conv_id=? AND (participant_a=? OR participant_b=?)`, conv, viewer, viewer).Scan(&pair).Error; err != nil {
			fail(c, 503, "PM_UNAVAILABLE", "私信暂时不可用", nil)
			return true
		}
		peer = pair.ParticipantA
		if peer == viewer {
			peer = pair.ParticipantB
		}
	}
	relevant, err := managedInboxPair(s.db, viewer, peer)
	if err != nil {
		fail(c, 503, "PM_UNAVAILABLE", "私信暂时不可用", nil)
		return true
	}
	if !relevant && managedOnly {
		return false
	}
	if (req.ConvID != "" && req.ReceiverID != "") || peer == 0 || viewer == peer || !utf8.Valid(body) || textguard.ValidateMessageContent(req.Content) != nil || utf8.RuneCountInString(req.Content) > 10000 || strings.TrimSpace(req.Content) == "" {
		fail(c, 400, "INVALID_MESSAGE", "私信对象或内容无效", nil)
		return true
	}
	content := strings.TrimSpace(req.Content)
	// The standard SendPM API has no idempotency key. Mirror its short duplicate
	// protection with a sender-scoped digest while preserving the legacy response.
	key := "managed-inbox:" + managedTextKey(fmt.Sprint(peer, ":", conv, ":", content, ":", time.Now().Unix()/60))
	id, err := s.elsewhereOperation(ctx, viewer, key, req, func(tx *gorm.DB, id int64) error {
		if err := pmdal.LockRelationPair(tx, viewer, peer); err != nil {
			return err
		}
		if err := canCommunicate(tx, viewer, peer, false); err != nil {
			return err
		}
		var thread pmdal.Conversation
		if conv > 0 {
			if err := tx.Raw(`SELECT * FROM conversations WHERE conv_id=? FOR UPDATE`, conv).Scan(&thread).Error; err != nil {
				return err
			}
			if thread.ConvID == 0 || thread.Status != 0 || thread.TopicStatus != pmdal.TopicStatusOpen {
				return gorm.ErrRecordNotFound
			}
		} else {
			lo, hi := viewer, peer
			if lo > hi {
				lo, hi = hi, lo
			}
			if err := tx.Where("participant_a=? AND participant_b=? AND origin_id=0", lo, hi).Limit(1).Find(&thread).Error; err != nil {
				return err
			}
			if thread.ConvID > 0 && (thread.Status != 0 || thread.TopicStatus != pmdal.TopicStatusOpen) {
				return gorm.ErrRecordNotFound
			}
			if thread.ConvID == 0 {
				origin, err := managedInboxOrigin(tx, viewer, peer)
				if err != nil {
					return err
				}
				cid, err := s.idgen.NextID()
				if err != nil {
					return err
				}
				var names []struct {
					AgentID   int64
					AgentName string
				}
				if err := tx.Raw(`SELECT agent_id,agent_name FROM agents WHERE agent_id IN (?,?)`, lo, hi).Scan(&names).Error; err != nil {
					return err
				}
				nm := map[int64]string{}
				for _, n := range names {
					nm[n.AgentID] = n.AgentName
				}
				thread = pmdal.Conversation{ConvID: cid, ParticipantA: lo, ParticipantB: hi, ParticipantAName: nm[lo], ParticipantBName: nm[hi], InitiatorID: viewer, OriginType: origin, TopicStatus: pmdal.TopicStatusOpen}
				if err := pmdal.CreateConversation(tx, &thread); err != nil {
					return err
				}
			}
			conv = thread.ConvID
		}
		if err := managedInboxWindow(tx, conv, viewer, peer); err != nil {
			return err
		}
		// Check duplicate content across the minute boundary as well.
		var prior int64
		if err := tx.Raw(`SELECT msg_id FROM private_messages WHERE conv_id=? AND sender_id=? AND content=? AND created_at>? ORDER BY msg_id DESC LIMIT 1`, conv, viewer, content, time.Now().Add(-time.Minute).UnixMilli()).Scan(&prior).Error; err != nil {
			return err
		}
		if prior > 0 {
			return errors.New("PM_DUPLICATE")
		}
		sender, receiver := thread.ParticipantAName, thread.ParticipantBName
		if viewer != thread.ParticipantA {
			sender, receiver = receiver, sender
		}
		if err := pmdal.CreateMessage(tx, &pmdal.PrivateMessage{MsgID: id, ConvID: conv, SenderID: viewer, ReceiverID: peer, SenderName: sender, ReceiverName: receiver, Content: content}); err != nil {
			return err
		}
		return pmdal.UpdateConversationAfterMessage(tx, conv, viewer)
	})
	if err != nil {
		if err.Error() == "PM_WAITING_FOR_PEER_REPLY" {
			fail(c, 429, "PM_WAITING_FOR_PEER_REPLY", "等待对方回复后再发送", nil)
		} else {
			s.elsewhereFailure(c, err)
		}
		return true
	}
	var saved struct{ ConvID, ReceiverID int64 }
	if err := s.db.Raw(`SELECT conv_id,receiver_id FROM private_messages WHERE msg_id=? AND sender_id=?`, id, viewer).Scan(&saved).Error; err != nil {
		fail(c, 503, "PM_UNAVAILABLE", "私信回执暂不可用", nil)
		return true
	}
	if s.redisClient != nil {
		s.redisClient.Del(ctx, fmt.Sprintf("pm:fetch:%d", saved.ReceiverID))
		s.redisClient.Publish(ctx, fmt.Sprintf("pm:push:%d", saved.ReceiverID), fmtRun(id))
	}
	c.JSON(200, map[string]any{"code": 0, "msg": "success", "data": map[string]string{"msg_id": fmtRun(id), "conv_id": fmtRun(saved.ConvID)}})
	return true
}
