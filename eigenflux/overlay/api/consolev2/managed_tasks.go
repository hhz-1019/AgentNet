package consolev2

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

type managedQueueSchedule struct {
	Revision   int64 `json:"revision"`
	DailyLimit int   `json:"daily_limit"`
	StartHour  int   `json:"start_hour"`
	EndHour    int   `json:"end_hour"`
}
type managedQueueRequest struct {
	Topic           string                `json:"topic"`
	Action          string                `json:"action"`
	RequestKey      string                `json:"request_key"`
	RecipientNumber string                `json:"recipient_number"`
	RecipientID     string                `json:"recipient_id"`
	Schedule        *managedQueueSchedule `json:"schedule"`
}

var managedTaskKey = regexp.MustCompile(`^[a-zA-Z0-9:_-]{1,100}$`)

func (s *Service) queueManaged(_ context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	id := socialDecimal(c.Param("member_id"))
	var req managedQueueRequest
	if decodeBody(c, &req) != nil || utf8.RuneCountInString(req.Topic) > 600 || socialSecretPattern.MatchString(req.Topic) || managedPrivatePattern.MatchString(req.Topic) || (req.Action != "" && req.Action != "post" && req.Action != "message") || (req.RequestKey != "" && !managedTaskKey.MatchString(req.RequestKey)) {
		fail(c, 400, "MANAGED_TOPIC_INVALID", "请检查活动类型和主题，主题限600字且不能包含私密信息", nil)
		return
	}
	if req.Schedule != nil {
		v := req.Schedule
		if v.DailyLimit < 0 || v.DailyLimit > 12 || v.StartHour < 0 || v.EndHour > 24 || v.StartHour >= v.EndHour {
			fail(c, 400, "MANAGED_SCHEDULE_INVALID", "请检查每日次数与活动时段", nil)
			return
		}
	}
	if !managedModelConfigured() || os.Getenv("AGENTNET_MANAGED_WORKER") != "true" {
		fail(c, 409, "MANAGED_NOT_READY", "平台模型或调度器尚未配置", nil)
		return
	}
	replyData, blocked, err := s.queueManagedTask(owner, id, req)
	if err != nil {
		s.managedError(c, err)
		return
	}
	if blocked != "" {
		fail(c, 409, "MANAGED_ACTIVITY_BLOCKED", blocked, nil)
		return
	}
	reply(c, 200, replyData)
}

func (s *Service) queueManagedTask(owner string, id int64, req managedQueueRequest) (map[string]any, string, error) {
	var blocked string
	var revision int64
	key := req.RequestKey
	raw, _ := json.Marshal(req)
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	if key == "" {
		n, err := s.idgen.NextID()
		if err != nil {
			return nil, "", err
		}
		key = fmtRun(n)
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(734817615)`).Error; err != nil {
			return err
		}
		// Match commit's lock order. A role edit and a task submission cannot race.
		if err := tx.Exec(`SELECT sponsor_uid FROM managed_campaigns WHERE sponsor_uid=? FOR UPDATE`, owner).Error; err != nil {
			return err
		}
		var m struct {
			AgentID                          int64
			Revision                         int64
			PendingTaskID, PendingTaskDigest string
		}
		if err := tx.Raw(`SELECT agent_id,revision,pending_task_id,pending_task_digest FROM managed_members WHERE agent_id=? AND sponsor_uid=? AND deleted_at=0 FOR UPDATE`, id, owner).Scan(&m).Error; err != nil {
			return err
		}
		if m.AgentID == 0 {
			return errUnauthorized
		}
		revision = m.Revision
		var prior struct {
			AgentID    int64
			TaskDigest string
		}
		if err := tx.Raw(`SELECT agent_id,task_digest FROM managed_runs WHERE sponsor_uid=? AND task_id=? UNION ALL SELECT agent_id,pending_task_digest FROM managed_members WHERE sponsor_uid=? AND pending_task_id=? LIMIT 1`, owner, key, owner, key).Scan(&prior).Error; err != nil {
			return err
		}
		if prior.AgentID > 0 {
			if prior.AgentID != id || prior.TaskDigest != digest {
				return errConflict
			}
			return nil
		}
		if m.PendingTaskID != "" {
			blocked = "已有待执行任务，请等待回执后再安排"
			return nil
		}
		if req.Schedule != nil && req.Schedule.Revision != m.Revision {
			return errConflict
		}
		var err error
		blocked, err = managedQueueBlockWithSchedule(tx, owner, id, time.Now(), req.Schedule)
		if err != nil || blocked != "" {
			return err
		}
		if req.RecipientNumber != "" && req.RecipientID != "" {
			blocked = "只填写一个私信对象"
			return nil
		}
		var peer int64
		if req.RecipientNumber != "" {
			if lookupOwnerNumber(req.RecipientNumber) == 0 {
				blocked = "私信对象UID无效"
				return nil
			}
			if err := tx.Raw(`SELECT a.agent_id FROM human_accounts h JOIN agent_owners o ON o.owner_uid=h.uid JOIN agents a USING(agent_id) WHERE h.account_number=? AND a.identity_state='active' ORDER BY o.created_at LIMIT 1`, req.RecipientNumber).Scan(&peer).Error; err != nil {
				return err
			}
		} else if req.RecipientID != "" {
			peer = socialDecimal(req.RecipientID)
		}
		action := req.Action
		if req.RecipientNumber != "" || req.RecipientID != "" {
			if peer == 0 || peer == id {
				blocked = "私信对象不存在或为当前角色"
				return nil
			}
			if action == "post" {
				blocked = "发帖任务不能填写私信对象"
				return nil
			}
			action = "message"
			var existing bool
			if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM conversations WHERE ((participant_a=? AND participant_b=?) OR (participant_a=? AND participant_b=?)) AND origin_id=0)`, id, peer, peer, id).Scan(&existing).Error; err != nil {
				return err
			}
			allowed, err := managedMessagePermission(tx, managedJob{AgentID: id, SponsorUID: owner}, peer, existing)
			if err != nil {
				return err
			}
			if !allowed {
				blocked = "请检查角色与平台的私信开关、管理登录和屏蔽状态"
				return nil
			}
		} else if action == "" && strings.TrimSpace(req.Topic) != "" {
			action = "post"
		}
		if action == "message" {
			target, _, err := s.managedMessageCandidate(tx, managedJob{AgentID: id, SponsorUID: owner, RecipientID: peer})
			if err != nil {
				return err
			}
			if target == nil {
				blocked = "当前没有可接续的私信，或私信尚在等待回复"
				return nil
			}
		}
		// Explicit post tasks may share a theme; deduplication applies to the actual
		// content, not a group experiment's topic. Legacy requests keep their guard.
		if req.Action == "" && peer == 0 && strings.TrimSpace(req.Topic) != "" {
			var duplicate bool
			if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_runs WHERE sponsor_uid=? AND topic_key=? AND created_at>? AND status='published') OR EXISTS(SELECT 1 FROM managed_members WHERE sponsor_uid=? AND agent_id<>? AND deleted_at=0 AND pending_topic=?)`, owner, managedTextKey(req.Topic), time.Now().Add(-24*time.Hour).UnixMilli(), owner, id, strings.TrimSpace(req.Topic)).Scan(&duplicate).Error; err != nil {
				return err
			}
			if duplicate {
				blocked = "近期已有相同选题，请换一个具体切口"
				return nil
			}
		}
		if req.Schedule != nil {
			v := req.Schedule
			revision++
			if err := tx.Exec(`UPDATE managed_members SET daily_limit=?,start_hour=?,end_hour=?,revision=? WHERE agent_id=?`, v.DailyLimit, v.StartHour, v.EndHour, revision, id).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec(`UPDATE managed_members SET next_run_at=?,pending_topic=?,pending_recipient_id=NULLIF(?,0),pending_action=?,pending_task_id=?,pending_task_digest=? WHERE agent_id=?`, time.Now().UnixMilli(), strings.TrimSpace(req.Topic), peer, action, key, digest, id).Error; err != nil {
			return err
		}
		return managedAudit(tx, owner, "queue_member", id)
	})
	return map[string]any{"queued": true, "task_id": key, "revision": revision}, blocked, err
}

// Incoming replies can wake a role before its next public slot, but never
// overwrite a pending operator task. Bound failures prevent a hot retry loop.
const managedIncomingSQL = `(m.pending_task_id='' AND m.pending_topic='' AND m.pending_recipient_id IS NULL AND c.dm_reply_enabled
 AND EXISTS(SELECT 1 FROM agent_settings g WHERE g.agent_id=m.agent_id AND g.auto_reply_pm)
 AND NOT EXISTS(SELECT 1 FROM console_v2_sessions cs JOIN managed_delegations d USING(session_id) WHERE cs.agent_id=m.agent_id AND cs.status='active' AND cs.idle_expires_at>extract(epoch FROM now())*1000 AND cs.absolute_expires_at>extract(epoch FROM now())*1000)
 AND NOT EXISTS(SELECT 1 FROM agent_principals ap WHERE ap.agent_id=m.agent_id AND ap.status='active')
 AND NOT EXISTS(SELECT 1 FROM managed_runs r WHERE r.agent_id=m.agent_id AND r.requested_action='message' AND r.created_at>extract(epoch FROM now())*1000-120000)
 AND EXISTS(SELECT 1 FROM private_messages pm JOIN conversations conv USING(conv_id) JOIN agents peer ON peer.agent_id=pm.sender_id
 WHERE pm.receiver_id=m.agent_id AND peer.identity_state='active' AND conv.origin_type IN ('friend','direct','broadcast') AND conv.status=0 AND conv.topic_status=1 AND pm.created_at>extract(epoch FROM now())*1000-604800000
 AND NOT EXISTS(SELECT 1 FROM private_messages newer WHERE newer.conv_id=pm.conv_id AND newer.msg_id>pm.msg_id)
 AND NOT EXISTS(SELECT 1 FROM managed_message_receipts r WHERE r.sender_id=m.agent_id AND r.trigger_key='message:'||pm.msg_id::text)
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=m.agent_id AND b.to_uid=pm.sender_id) OR (b.to_uid=m.agent_id AND b.from_uid=pm.sender_id)))
 AND NOT EXISTS(SELECT 1 FROM managed_message_receipts r WHERE ((r.sender_id=m.agent_id AND r.receiver_id=pm.sender_id) OR (r.receiver_id=m.agent_id AND r.sender_id=pm.sender_id)) AND r.decision='sent' AND r.created_at>extract(epoch FROM now())*1000-1800000)))`
