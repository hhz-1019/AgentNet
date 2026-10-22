package consolev2

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
)

type avatarPreview struct {
	Avatar  string `json:"avatar"`
	Preview string `json:"preview"`
	Color   string `json:"color"`
}

func (s *Service) avatarPreviews(ctx context.Context, avatars map[string]string) map[string]avatarPreview {
	result := map[string]avatarPreview{}
	ids := []string{}
	for _, url := range avatars {
		if customAvatarPattern.MatchString(url) {
			ids = append(ids, strings.TrimPrefix(url, avatarPrefix))
		}
	}
	if len(ids) == 0 {
		return result
	}
	var rows []struct{ AvatarID, Preview string }
	if s.db.WithContext(ctx).Raw(`SELECT avatar_id,COALESCE(preview,'{}'::jsonb)::text AS preview FROM agent_avatars WHERE avatar_id IN ?`, ids).Scan(&rows).Error != nil {
		return result
	}
	byURL := map[string]imagePreview{}
	for _, row := range rows {
		var p imagePreview
		_ = json.Unmarshal([]byte(row.Preview), &p)
		byURL[avatarPrefix+row.AvatarID] = p
	}
	for agent, url := range avatars {
		if p, ok := byURL[url]; ok {
			result[agent] = avatarPreview{url, p.Preview, p.Color}
		}
	}
	return result
}

// Only avatar fields from authors already admitted by the feed visibility check.
func (s *Service) addPostAvatars(ctx context.Context, posts []socialPostRow) {
	if len(posts) == 0 {
		return
	}
	ids := []int64{}
	for _, p := range posts {
		ids = append(ids, p.AgentID)
	}
	var rows []struct {
		AgentID int64
		Avatar  string
	}
	if s.db.WithContext(ctx).Raw(`SELECT o.agent_id,COALESCE(t.portrait_fields->>'avatar','') AS avatar FROM agent_owners o JOIN twin_users t ON t.user_id=o.owner_uid JOIN agents a ON a.agent_id=o.agent_id WHERE a.identity_state='active' AND o.agent_id IN ?`, ids).Scan(&rows).Error != nil {
		return
	}
	avatars := map[string]string{}
	for _, r := range rows {
		if validPortraitAvatar(r.Avatar) {
			avatars[strconv.FormatInt(r.AgentID, 10)] = r.Avatar
		}
	}
	previews := s.avatarPreviews(ctx, avatars)
	for i, p := range posts {
		id := strconv.FormatInt(p.AgentID, 10)
		portrait := avatarPreview{Avatar: avatars[id]}
		if preview, ok := previews[id]; ok {
			portrait = preview
		}
		if p.IsOfficial {
			portrait = avatarPreview{Avatar: officialAvatar}
		}
		posts[i].AuthorAvatar = &portrait
	}
}
