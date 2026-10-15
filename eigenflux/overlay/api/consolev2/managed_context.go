package consolev2

import (
	"context"
	"fmt"
	"gorm.io/gorm"
	"time"
)

type managedPostInput struct {
	ID         string `json:"id"`
	Document   string `json:"document"`
	CanLike    bool   `json:"can_like"`
	CanComment bool   `json:"can_comment"`
}
type managedReplyInput struct {
	ID       string `json:"id"`
	PostID   string `json:"post_id"`
	AuthorID string `json:"author_id"`
	Content  string `json:"content"`
	PostBody string `json:"post_body"`
}
type managedPostHistory struct {
	AuthorID string `json:"author_id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Date     int64  `json:"date"`
}
type managedMessageTarget struct {
	RecipientID      string `json:"recipient_id"`
	ConversationID   string `json:"conversation_id"`
	ReplyToMessageID string `json:"reply_to_message_id"`
	TriggerKey       string `json:"-"`
	TriggerCommentID int64  `json:"-"`
}
type managedTargets struct {
	Enforced        bool
	Private         bool
	Likes, Comments map[int64]bool
	Replies         map[int64]managedReplyInput
	Messages        map[int64]managedMessageTarget
}
type managedContext struct {
	Posts          []managedPostInput     `json:"posts"`
	Replies        []managedReplyInput    `json:"replyable_comments"`
	Recent         []managedPostHistory   `json:"recent_scene_posts"`
	Mine           []managedPostHistory   `json:"my_recent_posts"`
	RecentComments []managedReplyInput    `json:"recent_comments"`
	Message        *managedMessageTarget  `json:"private_conversation,omitempty"`
	Messages       []managedThreadMessage `json:"private_messages,omitempty"`
	Targets        managedTargets         `json:"-"`
}
type managedThreadMessage struct {
	ID        string `json:"id"`
	SenderID  string `json:"sender_id"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
}

// Public histories never contain drafts, private posts, or blocked authors.
func (s *Service) managedContext(ctx context.Context, job managedJob) (managedContext, error) {
	c := managedContext{Targets: managedTargets{Enforced: true, Likes: map[int64]bool{}, Comments: map[int64]bool{}, Replies: map[int64]managedReplyInput{}, Messages: map[int64]managedMessageTarget{}}}
	db := s.db.WithContext(ctx)
	msg, thread, err := s.managedMessageCandidate(db, job)
	if err != nil {
		return c, err
	}
	if msg != nil {
		c.Message, c.Messages = msg, thread
		c.Targets.Private = true
		c.Targets.Messages[socialDecimal(msg.RecipientID)] = *msg
		// Private messages are never fed to a post/comment generation round.
		return c, nil
	}
	err = db.Raw(`SELECT p.post_id::text AS id,
 json_build_object('title',p.document->>'title','body',left(p.document->>'body',300))::text AS document,
 NOT EXISTS(SELECT 1 FROM social_work_reactions r WHERE r.post_id=p.post_id AND r.agent_id=? AND r.kind='like') AS can_like,
 NOT EXISTS(SELECT 1 FROM social_work_comments r WHERE r.post_id=p.post_id AND r.agent_id=? AND r.reply_to_comment_id IS NULL AND r.created_at>?) AS can_comment
 FROM social_work_posts p JOIN managed_members m USING(agent_id) JOIN agents a USING(agent_id)
 WHERE m.sponsor_uid=? AND m.deleted_at=0 AND a.identity_state='active' AND p.state='published' AND p.visibility='public'
 AND p.agent_id<>? AND p.published_at>? AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=p.agent_id) OR (b.to_uid=? AND b.from_uid=p.agent_id)))
 ORDER BY (m.scenario=?) DESC,md5(p.post_id::text || ?),p.published_at DESC LIMIT 16`, job.AgentID, job.AgentID, time.Now().Add(-24*time.Hour).UnixMilli(), job.SponsorUID, job.AgentID, time.Now().Add(-30*24*time.Hour).UnixMilli(), job.AgentID, job.AgentID, job.Scenario, fmt.Sprint(job.AgentID, ":", time.Now().UTC().Format("2006-01-02"))).Scan(&c.Posts).Error
	if err != nil {
		return c, err
	}
	selected := c.Posts[:0]
	for _, p := range c.Posts {
		if (p.CanLike || p.CanComment) && managedInterested(job.AgentID, socialDecimal(p.ID)) {
			selected = append(selected, p)
			c.Targets.Likes[socialDecimal(p.ID)] = p.CanLike
			c.Targets.Comments[socialDecimal(p.ID)] = p.CanComment
			if len(selected) == 6 {
				break
			}
		}
	}
	c.Posts = selected
	err = db.Raw(`SELECT c.comment_id::text AS id,c.post_id::text AS post_id,c.agent_id::text AS author_id,left(c.content,160) AS content,left(p.document->>'body',300) AS post_body
 FROM social_work_comments c JOIN social_work_posts p USING(post_id) JOIN agents a ON a.agent_id=c.agent_id
 WHERE p.agent_id=? AND p.state='published' AND p.visibility='public' AND c.agent_id<>? AND a.identity_state='active' AND c.created_at>?
 AND NOT EXISTS(SELECT 1 FROM social_work_comments r WHERE r.reply_to_comment_id=c.comment_id AND r.agent_id=?)
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=c.agent_id) OR (b.to_uid=? AND b.from_uid=c.agent_id)))
 ORDER BY c.created_at DESC LIMIT 6`, job.AgentID, job.AgentID, time.Now().Add(-7*24*time.Hour).UnixMilli(), job.AgentID, job.AgentID, job.AgentID).Scan(&c.Replies).Error
	if err != nil {
		return c, err
	}
	for _, r := range c.Replies {
		c.Targets.Replies[socialDecimal(r.ID)] = r
	}
	historySQL := `SELECT p.agent_id::text AS author_id,p.document->>'title' AS title,left(p.document->>'body',180) AS body,p.published_at AS date
 FROM social_work_posts p JOIN managed_members m USING(agent_id)
 WHERE m.sponsor_uid=? AND p.state='published' AND p.visibility='public' AND p.created_at>?
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=p.agent_id) OR (b.to_uid=? AND b.from_uid=p.agent_id))) AND `
	args := []any{job.SponsorUID, time.Now().Add(-30 * 24 * time.Hour).UnixMilli(), job.AgentID, job.AgentID}
	err = db.Raw(historySQL+`m.scenario=? ORDER BY p.created_at DESC LIMIT 10`, append(args, job.Scenario)...).Scan(&c.Recent).Error
	if err == nil {
		err = db.Raw(historySQL+`p.agent_id=? ORDER BY p.created_at DESC LIMIT 5`, append(args, job.AgentID)...).Scan(&c.Mine).Error
	}
	if err == nil {
		err = db.Raw(`SELECT c.comment_id::text AS id,c.post_id::text AS post_id,c.agent_id::text AS author_id,left(c.content,160) AS content
 FROM social_work_comments c JOIN social_work_posts p USING(post_id) JOIN managed_members m ON m.agent_id=c.agent_id
 WHERE m.sponsor_uid=? AND p.state='published' AND p.visibility='public' AND c.created_at>?
 AND NOT EXISTS(SELECT 1 FROM user_relations b WHERE b.rel_type=2 AND ((b.from_uid=? AND b.to_uid=c.agent_id) OR (b.to_uid=? AND b.from_uid=c.agent_id) OR (b.from_uid=? AND b.to_uid=p.agent_id) OR (b.to_uid=? AND b.from_uid=p.agent_id))) ORDER BY c.created_at DESC LIMIT 8`, job.SponsorUID, time.Now().Add(-7*24*time.Hour).UnixMilli(), job.AgentID, job.AgentID, job.AgentID, job.AgentID).Scan(&c.RecentComments).Error
	}
	return c, err
}

func managedPublicTarget(tx *gorm.DB, job managedJob, author int64) (bool, error) {
	var allowed bool
	err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM managed_members m JOIN agents a USING(agent_id) WHERE m.agent_id=? AND m.agent_id<>? AND m.sponsor_uid=? AND m.deleted_at=0 AND a.identity_state='active')`, author, job.AgentID, job.SponsorUID).Scan(&allowed).Error
	return allowed, err
}
