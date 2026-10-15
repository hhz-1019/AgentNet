package consolev2

import (
	"context"
	"strings"
	"sync"
)

type avatarPreview struct {
	Avatar  string `json:"avatar"`
	Preview string `json:"preview"`
	Color   string `json:"color"`
}

var avatarPreviewCache = struct {
	sync.Mutex
	values map[string]avatarPreview
	order  []string
}{values: map[string]avatarPreview{}}

// Avatar files are immutable. Cache only tiny rasters, and enrich only IDs
// already admitted by the public identity/visibility query.
func (s *Service) avatarPreviews(ctx context.Context, avatars map[string]string) map[string]avatarPreview {
	result := map[string]avatarPreview{}
	missing := map[string][]string{}
	for agent, url := range avatars {
		if !customAvatarPattern.MatchString(url) {
			continue
		}
		avatarPreviewCache.Lock()
		preview, ok := avatarPreviewCache.values[url]
		avatarPreviewCache.Unlock()
		if ok {
			result[agent] = preview
		} else {
			id := strings.TrimPrefix(url, avatarPrefix)
			missing[id] = append(missing[id], agent)
		}
	}
	if len(missing) == 0 {
		return result
	}
	ids := make([]string, 0, len(missing))
	for id := range missing {
		ids = append(ids, id)
	}
	var rows []struct {
		AvatarID string
		Content  []byte
	}
	if s.db.WithContext(ctx).Raw(`SELECT avatar_id,content FROM agent_avatars WHERE avatar_id IN ? AND octet_length(content)<=8388608`, ids).Scan(&rows).Error != nil {
		return result
	}
	for _, row := range rows {
		p := makeImagePreview(row.Content)
		if p.Preview == "" {
			continue
		}
		url := avatarPrefix + row.AvatarID
		preview := avatarPreview{url, p.Preview, p.Color}
		for _, agent := range missing[row.AvatarID] {
			result[agent] = preview
		}
		avatarPreviewCache.Lock()
		if _, exists := avatarPreviewCache.values[url]; !exists {
			if len(avatarPreviewCache.order) >= 256 {
				delete(avatarPreviewCache.values, avatarPreviewCache.order[0])
				avatarPreviewCache.order = avatarPreviewCache.order[1:]
			}
			avatarPreviewCache.order = append(avatarPreviewCache.order, url)
		}
		avatarPreviewCache.values[url] = preview
		avatarPreviewCache.Unlock()
	}
	return result
}
