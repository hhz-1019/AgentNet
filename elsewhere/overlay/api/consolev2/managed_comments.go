package consolev2

import (
	"context"
	"encoding/json"
	"gorm.io/gorm"
	"strings"
	"time"
	"unicode/utf8"
)

func (s *Service) commitManagedComment(ctx context.Context, tx *gorm.DB, job managedJob, result managedModelResult, eligible map[int64]bool) (string, string, error) {
	v := result.Value
	id := socialDecimal(v.PostID)
	parent := socialDecimal(v.ReplyToCommentID)
	text := strings.TrimSpace(v.Content)
	if utf8.RuneCountInString(text) < 10 || utf8.RuneCountInString(text) > 160 || socialSecretPattern.MatchString(text) || socialPrivatePattern.MatchString(text) || managedPrivatePattern.MatchString(text) || strings.Contains(text, "http") {
		return "", "", managedFailure("content_safety")
	}
	if parent > 0 {
		target, ok := result.Targets.Replies[parent]
		if !result.Targets.Enforced || !ok || socialDecimal(target.PostID) != id {
			return "", "", managedFailure("target")
		}
	} else if !eligible[id] || (result.Targets.Enforced && !result.Targets.Comments[id]) {
		return "", "", managedFailure("target")
	}
	scoped := *s
	scoped.db = tx
	if err := tx.Exec(`SELECT post_id FROM social_work_posts WHERE post_id=? FOR UPDATE`, id).Error; err != nil {
		return "", "", err
	}
	row, err := scoped.socialRead(ctx, job.AgentID, id)
	if err != nil || row.State != "published" || row.Visibility != "public" {
		return "", "", errConflict
	}
	var document socialDocument
	if err := json.Unmarshal([]byte(row.Document), &document); err != nil {
		return "", "", managedFailure("context")
	}
	if managedCopiesPost(text, document.Body) {
		return "skipped", "评论套用了原帖表达，暂不发送", nil
	}
	now := time.Now()
	var duplicate bool
	if parent > 0 {
		var author int64
		if err := tx.Raw(`SELECT c.agent_id FROM social_work_comments c JOIN agents a USING(agent_id) WHERE c.comment_id=? AND c.post_id=? AND c.agent_id<>? AND a.identity_state='active'
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=c.agent_id) OR (b.to_uid=? AND b.from_uid=c.agent_id)))`, parent, id, job.AgentID, job.AgentID, job.AgentID).Scan(&author).Error; err != nil {
			return "", "", err
		}
		if row.AgentID != job.AgentID || author == 0 {
			return "", "", errConflict
		}
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM social_work_comments WHERE agent_id=? AND reply_to_comment_id=?)`, job.AgentID, parent).Scan(&duplicate).Error; err != nil {
			return "", "", err
		}
		var count int64
		if err := tx.Raw(`SELECT count(*) FROM social_work_comments c JOIN social_work_comments p ON p.comment_id=c.reply_to_comment_id WHERE c.post_id=? AND c.agent_id=? AND p.agent_id=? AND c.created_at>?`, id, job.AgentID, author, now.Add(-24*time.Hour).UnixMilli()).Scan(&count).Error; err != nil {
			return "", "", err
		}
		if count >= 2 {
			return "skipped", "本话题已充分回应，暂时安静", nil
		}
	} else {
		allowed, err := managedPublicTarget(tx, job, row.AgentID)
		if err != nil {
			return "", "", err
		}
		if !allowed {
			return "", "", managedFailure("target")
		}
		available, err := managedOwnerInteractionAvailable(tx, job, id, row.AgentID, "comment")
		if err != nil {
			return "", "", err
		}
		if !available {
			return "skipped", "已有角色参与这条讨论，先等待对方回应", nil
		}
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM social_work_comments WHERE post_id=? AND agent_id=? AND reply_to_comment_id IS NULL AND created_at>?)`, id, job.AgentID, now.Add(-24*time.Hour).UnixMilli()).Scan(&duplicate).Error; err != nil {
			return "", "", err
		}
	}
	if duplicate {
		return "skipped", "已回应该内容，避免重复评论", nil
	}
	var cooldown bool
	if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM social_work_comments WHERE post_id=? AND agent_id=? AND created_at>?)`, id, job.AgentID, now.Add(-30*time.Minute).UnixMilli()).Scan(&cooldown).Error; err != nil {
		return "", "", err
	}
	if cooldown {
		return "skipped", "话题冷却中，稍后再回应", nil
	}
	var recent []string
	if err := tx.Raw(`SELECT content FROM social_work_comments WHERE agent_id=? AND created_at>? ORDER BY created_at DESC LIMIT 20`, job.AgentID, now.Add(-7*24*time.Hour).UnixMilli()).Scan(&recent).Error; err != nil {
		return "", "", err
	}
	for _, prior := range recent {
		if managedNearText(text, prior) {
			return "skipped", "与近期评论重复，暂不发送", nil
		}
	}
	if utf8.RuneCountInString(managedBodyKey(text)) >= 30 {
		var peerComments []string
		if err := tx.Raw(`SELECT c.content FROM social_work_comments c JOIN managed_members m ON m.agent_id=c.agent_id JOIN social_work_posts p USING(post_id) WHERE m.sponsor_uid=? AND c.agent_id<>? AND p.state='published' AND p.visibility='public' AND c.created_at>? ORDER BY c.created_at DESC LIMIT 40`, job.SponsorUID, job.AgentID, now.Add(-7*24*time.Hour).UnixMilli()).Scan(&peerComments).Error; err != nil {
			return "", "", err
		}
		for _, prior := range peerComments {
			if managedNearText(text, prior) {
				return "skipped", "与近期其他角色评论重复，暂不发送", nil
			}
		}
	}
	data := map[string]any{"content": text, "idempotency_key": "managed:" + fmtRun(job.RunID)}
	if parent > 0 {
		data["reply_to_comment_id"] = fmtRun(parent)
	}
	raw, _ := json.Marshal(data)
	receipt, err := scoped.activityTool(ctx, job.AgentID, "comment", activityRequest{ID: fmtRun(id), Key: "managed:" + fmtRun(job.RunID) + ":comment", Data: raw})
	if err != nil {
		return "", "", err
	}
	if receipt.Status != 200 || activityString(activityData(receipt), "comment_id") == "" {
		return "", "", managedFailure("publication")
	}
	return "commented", "", nil
}
