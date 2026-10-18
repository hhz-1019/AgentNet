package consolev2

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
)

// Only authenticated browser business mutations enter this journal. Agent tools,
// page reads, sessions, telemetry and uploads are not human social actions.
func ownerAction(method, path string) string {
	if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return ""
	}
	switch {
	case path == "/api/v2/console/social/upload", strings.HasPrefix(path, "/api/v2/console/social/media"), strings.HasSuffix(path, "/read"), strings.HasSuffix(path, "/view"):
		return ""
	case strings.HasPrefix(path, "/api/v2/console/social/"):
		return "content"
	case strings.HasPrefix(path, "/api/v2/console/people/") && strings.HasSuffix(path, "/follow"):
		return "relationship"
	case strings.HasPrefix(path, "/api/v2/console/pm/"), strings.HasPrefix(path, "/api/v2/console/groups"):
		return "conversation"
	case strings.HasPrefix(path, "/api/v2/console/relations/"):
		return "relationship"
	case strings.HasPrefix(path, "/api/v2/console/portrait"), path == "/api/v2/agents/me/profile/fields", path == "/api/v2/agents/me/network-goal", strings.HasPrefix(path, "/api/v2/agents/me/intent-actions"):
		return "profile"
	case path == "/api/v2/console/companion", strings.HasPrefix(path, "/api/v2/console/twin"), path == "/api/v2/agents/me/security-boundary":
		return "activity_settings"
	case strings.HasPrefix(path, "/api/v2/console/attention-items/"), strings.HasPrefix(path, "/api/v2/console/moment/") && strings.HasSuffix(path, "/state"), path == "/api/v2/agent-commands":
		return "instruction"
	}
	return ""
}

// Store references and a few typed state values, never body/content, credentials,
// private memory or arbitrary client strings. IDs remain decimal strings.
func ownerTarget(raw []byte, target map[string]any) {
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &data) != nil {
		return
	}
	for _, key := range []string{"post_id", "comment_id", "conv_id", "msg_id", "receiver_id", "person_id", "group_id", "attention_id", "command_id", "organization_id", "member_id", "intent_id"} {
		var value string
		if json.Unmarshal(data[key], &value) != nil {
			value = string(data[key])
		}
		if socialDecimal(value) > 0 {
			target[key] = value
		}
	}
	for _, key := range []string{"active", "following", "enabled", "paused", "approved"} {
		var value bool
		if len(data[key]) > 0 && string(data[key]) != "null" && json.Unmarshal(data[key], &value) == nil {
			target[key] = value
		}
	}
	for key, values := range map[string]string{"kind": "|like|save|", "state": "|draft|published|deleted|pending|", "visibility": "|public|friends|private|", "role": "|editor|viewer|", "action": "|invite|revoke|", "topic_status": "|pending_verify|open|closed|"} {
		var value string
		if json.Unmarshal(data[key], &value) == nil && value != "" && !strings.Contains(value, "|") && strings.Contains(values, "|"+value+"|") {
			target[key] = value
		}
	}
}

// A durable intent precedes the mutation. A crash after the business commit
// leaves an uncertain event for read-back, never a silently missing action.
func (s *Service) beginOwnerAction(ctx context.Context, c *app.RequestContext) (func(), error) {
	method, route := string(c.Method()), c.FullPath()
	action := ownerAction(method, route)
	id, ok := agentID(c)
	if action == "" || !ok {
		return func() {}, nil
	}
	if _, human := c.Get("console_session_id"); !human {
		return func() {}, nil
	}
	target := map[string]any{}
	for _, p := range c.Params {
		if strings.HasSuffix(p.Key, "_id") && socialDecimal(p.Value) > 0 {
			target[p.Key] = p.Value
		}
	}
	body, _ := c.Body()
	ownerTarget(body, target)
	raw, _ := json.Marshal(target)
	var event int64
	err := s.db.WithContext(ctx).Raw(`INSERT INTO owner_activity_events(agent_id,action,method,route,target,created_at) VALUES(?,?,?,?,?::jsonb,?) RETURNING event_id`, id, action, method, route, string(raw), time.Now().UnixMilli()).Scan(&event).Error
	if err != nil {
		return nil, err
	}
	return func() {
		status := "applied"
		if c.Response.StatusCode() < 200 || c.Response.StatusCode() >= 300 {
			status = "failed"
		}
		if c.Response.StatusCode() >= 500 {
			status = "pending"
		}
		if status == "applied" {
			var envelope struct {
				Data json.RawMessage `json:"data"`
			}
			_ = json.Unmarshal(c.Response.Body(), &envelope)
			ownerTarget(envelope.Data, target)
			// Creation receipts use "id" for posts/comments, unlike route params.
			var data map[string]json.RawMessage
			_ = json.Unmarshal(envelope.Data, &data)
			var resource string
			_ = json.Unmarshal(data["id"], &resource)
			if action == "content" && (strings.Contains(route, "/posts/") || strings.Contains(route, "/drafts") || strings.HasSuffix(route, "/share")) && socialDecimal(resource) > 0 {
				key := "post_id"
				if strings.HasSuffix(route, "/comments") {
					key = "comment_id"
				}
				target[key] = resource
			}
		}
		raw, _ := json.Marshal(target)
		finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if e := s.db.WithContext(finishCtx).Exec(`UPDATE owner_activity_events SET status=?,target=?::jsonb,completed_at=?,acknowledged_at=NULL,resolution=NULL WHERE event_id=?`, status, string(raw), time.Now().UnixMilli(), event).Error; e != nil {
			slog.Error("owner activity completion pending", "event_id", event, "error", e)
		}
	}, nil
}

type ownerActivityEvent struct {
	ID        string          `json:"id"`
	Action    string          `json:"action"`
	Method    string          `json:"method"`
	Route     string          `json:"route"`
	Target    json.RawMessage `json:"target"`
	Status    string          `json:"status"`
	CreatedAt int64           `json:"created_at"`
}
type ownerActivityBatch struct {
	Events            []ownerActivityEvent      `json:"events"`
	HasMore           bool                      `json:"has_more"`
	RecentResolutions []ownerActivityResolution `json:"recent_resolutions"`
}
type ownerActivityResolution struct {
	Summary        string `json:"summary"`
	AcknowledgedAt int64  `json:"acknowledged_at"`
}

func (s *Service) ownerActivities(ctx context.Context, id int64) (ownerActivityBatch, error) {
	rows := []ownerActivityEvent{}
	err := s.db.WithContext(ctx).Raw(`SELECT event_id::text AS id,action,method,route,target,
 CASE WHEN status='pending' THEN 'uncertain' ELSE status END AS status,created_at
 FROM owner_activity_events WHERE agent_id=? AND acknowledged_at IS NULL
 AND (status='applied' OR (status='pending' AND created_at<?)) ORDER BY event_id LIMIT 11`, id, time.Now().Add(-2*time.Minute).UnixMilli()).Scan(&rows).Error
	batch := ownerActivityBatch{Events: rows, HasMore: len(rows) > 10}
	if batch.HasMore {
		batch.Events = rows[:10]
	}
	if err != nil {
		return batch, err
	}
	// The decision survives a host crash after ACK, and is also visible when the
	// same Agent resumes from another host. ACK is not a business-action receipt.
	batch.RecentResolutions = []ownerActivityResolution{}
	err = s.db.WithContext(ctx).Raw(`SELECT resolution AS summary,max(acknowledged_at) AS acknowledged_at
 FROM owner_activity_events WHERE agent_id=? AND acknowledged_at IS NOT NULL
 GROUP BY resolution ORDER BY max(acknowledged_at) DESC LIMIT 5`, id).Scan(&batch.RecentResolutions).Error
	return batch, err
}

func (s *Service) activityOwnerEvents(ctx context.Context, c *app.RequestContext, name string, req activityRequest) {
	id, _ := agentID(c)
	if name == "ack_owner_events" {
		var v struct {
			IDs     []string `json:"ids"`
			Summary string   `json:"summary"`
		}
		if json.Unmarshal(req.Data, &v) != nil || len(v.IDs) == 0 || len(v.IDs) > 50 || strings.TrimSpace(v.Summary) == "" || len([]rune(v.Summary)) > 1000 || socialSecretPattern.MatchString(v.Summary) || managedPrivatePattern.MatchString(v.Summary) {
			fail(c, 400, "OWNER_EVENTS_INVALID", "请提供已处理的操作及接续记录", nil)
			return
		}
		ids := []int64{}
		seen := map[int64]bool{}
		for _, value := range v.IDs {
			n := socialDecimal(value)
			if n == 0 || seen[n] {
				fail(c, 400, "OWNER_EVENTS_INVALID", "操作记录无效", nil)
				return
			}
			seen[n] = true
			ids = append(ids, n)
		}
		var count int64
		if err := s.db.WithContext(ctx).Raw(`SELECT count(*) FROM owner_activity_events WHERE agent_id=? AND event_id IN ? AND (status='applied' OR (status='pending' AND created_at<?))`, id, ids, time.Now().Add(-2*time.Minute).UnixMilli()).Scan(&count).Error; err != nil {
			s.socialFailure(c, err)
			return
		}
		if count != int64(len(ids)) {
			fail(c, 409, "OWNER_EVENTS_INVALID", "请重新读取操作记录", nil)
			return
		}
		if err := s.db.WithContext(ctx).Exec(`UPDATE owner_activity_events SET acknowledged_at=?,resolution=? WHERE agent_id=? AND event_id IN ? AND acknowledged_at IS NULL`, time.Now().UnixMilli(), v.Summary, id, ids).Error; err != nil {
			s.socialFailure(c, err)
			return
		}
		reply(c, 200, map[string]any{"acknowledged_ids": v.IDs, "summary": v.Summary})
		return
	}
	batch, err := s.ownerActivities(ctx, id)
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	reply(c, 200, batch)
}
