package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sync"
)

type socialPreviewKey struct{ media, agent int64 }

var socialPreviewCache = struct {
	sync.Mutex
	values map[socialPreviewKey]imagePreview
	order  []socialPreviewKey
}{values: map[socialPreviewKey]imagePreview{}}

// Enrich only rows already admitted by the publication/access query. Media
// must also belong to that row's author; guessing another owner's media ID
// cannot leak its pixels through inline previews. Stored media is immutable.
func (s *Service) addSocialImagePreviews(ctx context.Context, rows []socialPostRow) {
	docs := make([]socialDocument, len(rows))
	previews := map[socialPreviewKey]imagePreview{}
	missing := map[int64]bool{}
	for i, row := range rows {
		_ = json.Unmarshal([]byte(row.Document), &docs[i])
		for _, m := range docs[i].Media {
			if m.Kind != "image" && m.Kind != "chart" {
				continue
			}
			id := socialMediaID(m.URL)
			if id <= 0 {
				continue
			}
			key := socialPreviewKey{id, row.AgentID}
			socialPreviewCache.Lock()
			p, ok := socialPreviewCache.values[key]
			socialPreviewCache.Unlock()
			if ok {
				previews[key] = p
			} else {
				missing[id] = true
			}
		}
	}
	if len(missing) > 0 {
		ids := make([]int64, 0, len(missing))
		for id := range missing {
			ids = append(ids, id)
		}
		var media []struct {
			MediaID int64
			AgentID int64
			Content string
		}
		// Failed preview generation never makes the public feed fail.
		if s.db.WithContext(ctx).Raw(`SELECT media_id,agent_id,encode(content,'base64') AS content FROM social_media WHERE media_id IN ? AND content_type IN ('image/jpeg','image/png','image/gif') AND octet_length(content)<=8388608`, ids).Scan(&media).Error == nil {
			for _, m := range media {
				key := socialPreviewKey{m.MediaID, m.AgentID}
				data, err := base64.StdEncoding.DecodeString(m.Content)
				if err != nil {
					continue
				}
				p := makeImagePreview(data)
				previews[key] = p
				socialPreviewCache.Lock()
				if _, exists := socialPreviewCache.values[key]; !exists {
					if len(socialPreviewCache.order) >= 256 {
						delete(socialPreviewCache.values, socialPreviewCache.order[0])
						socialPreviewCache.order = socialPreviewCache.order[1:]
					}
					socialPreviewCache.order = append(socialPreviewCache.order, key)
				}
				socialPreviewCache.values[key] = p
				socialPreviewCache.Unlock()
			}
		}
	}
	for i := range rows {
		for j, m := range docs[i].Media {
			id := socialMediaID(m.URL)
			if id <= 0 || (m.Kind != "image" && m.Kind != "chart") {
				continue
			}
			p := previews[socialPreviewKey{id, rows[i].AgentID}]
			docs[i].Media[j].Width, docs[i].Media[j].Height = p.Width, p.Height
			docs[i].Media[j].Preview, docs[i].Media[j].Color = p.Preview, p.Color
		}
		if encoded, err := json.Marshal(docs[i]); err == nil {
			rows[i].Document = string(encoded)
		}
	}
}
