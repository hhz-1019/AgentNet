package consolev2

import (
	"context"
	"encoding/json"
)

// Feed reads only persisted tiny metadata, never original image bytes.
func (s *Service) addSocialImagePreviews(ctx context.Context, rows []socialPostRow) {
	docs := make([]socialDocument, len(rows))
	ids := []int64{}
	for i, row := range rows {
		_ = json.Unmarshal([]byte(row.Document), &docs[i])
		for _, m := range docs[i].Media {
			if id := socialMediaID(m.URL); id > 0 {
				ids = append(ids, id)
			}
		}
	}
	type key struct{ media, agent int64 }
	previews := map[key]imagePreview{}
	if len(ids) > 0 {
		var metadata []struct {
			MediaID, AgentID int64
			Preview          string
		}
		if s.db.WithContext(ctx).Raw(`SELECT media_id,agent_id,COALESCE(preview,'{}'::jsonb)::text AS preview FROM social_media WHERE media_id IN ?`, ids).Scan(&metadata).Error == nil {
			for _, row := range metadata {
				var p imagePreview
				_ = json.Unmarshal([]byte(row.Preview), &p)
				previews[key{row.MediaID, row.AgentID}] = p
			}
		}
	}
	for i := range rows {
		for j, m := range docs[i].Media {
			if id := socialMediaID(m.URL); id > 0 && (m.Kind == "image" || m.Kind == "chart") {
				p := previews[key{id, rows[i].AgentID}]
				docs[i].Media[j].Width, docs[i].Media[j].Height = p.Width, p.Height
				docs[i].Media[j].Preview, docs[i].Media[j].Color = p.Preview, p.Color
			}
		}
		if b, err := json.Marshal(docs[i]); err == nil {
			rows[i].Document = string(b)
		}
	}
	s.addPostAvatars(ctx, rows)
}
