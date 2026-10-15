package consolev2

import (
	"context"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
)

func validDefaultAvatar(id string) bool {
	switch id {
	case "", "citrus", "bloom", "tide", "sprout", "spark", "orbit":
		return true
	}
	return false
}

// Only public avatar IDs are returned, never the private fields used to choose them.
func (s *Service) getAvatars(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	parts := strings.Split(c.Query("ids"), ",")
	if len(parts) > 100 {
		fail(c, 400, "INVALID_AVATAR_QUERY", "每次最多读取 100 个头像", nil)
		return
	}
	ids := []int64{}
	for _, part := range parts {
		id, err := strconv.ParseInt(part, 10, 64)
		if err != nil || id <= 0 {
			fail(c, 400, "INVALID_AVATAR_QUERY", "头像编号无效", nil)
			return
		}
		ids = append(ids, id)
	}
	var rows []struct {
		AgentID int64
		Avatar  string
	}
	err := s.db.WithContext(ctx).Raw(`SELECT a.agent_id, COALESCE(t.portrait_fields->>'avatar','') AS avatar
 FROM agents a LEFT JOIN agent_owners o USING(agent_id) LEFT JOIN twin_users t ON t.user_id=o.owner_uid
 WHERE a.agent_id IN ? AND a.identity_state='active' AND NOT EXISTS (SELECT 1 FROM user_relations b WHERE b.rel_type=2
 AND ((b.from_uid=? AND b.to_uid=a.agent_id) OR (b.to_uid=? AND b.from_uid=a.agent_id)))`, ids, viewer, viewer).Scan(&rows).Error
	if err != nil {
		s.socialFailure(c, err)
		return
	}
	avatars := map[string]string{}
	for _, row := range rows {
		if validPortraitAvatar(row.Avatar) {
			avatars[strconv.FormatInt(row.AgentID, 10)] = row.Avatar
		}
	}
	reply(c, 200, map[string]any{"avatars": avatars, "previews": s.avatarPreviews(ctx, avatars)})
}
