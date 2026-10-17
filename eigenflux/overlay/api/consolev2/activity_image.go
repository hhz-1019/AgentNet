package consolev2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/cloudwego/hertz/pkg/app"
)

// Selection is an Agent decision. Search metadata is evidence, not an instruction
// or a claim of ownership. Downloaded bytes are validated and stored locally.
type activityImageCandidate struct {
	Title     string `json:"title"`
	ImageURL  string `json:"image_url"`
	SourceURL string `json:"source_url"`
}
type activityPreparedImage struct {
	Candidates                []activityImageCandidate
	Content                   []byte
	SourceURL, Title, Problem string
	Status                    int
}

func prepareActivityImage(ctx context.Context, req activityRequest) *activityPreparedImage {
	p := &activityPreparedImage{Candidates: []activityImageCandidate{}, Status: 200}
	if req.URL == "" {
		if n := utf8.RuneCountInString(strings.TrimSpace(req.Query)); n < 2 || n > 160 || socialSecretPattern.MatchString(req.Query) {
			p.Status, p.Problem = 400, "provide a short public image search query"
			return p
		}
		raw, err := activitySearchData(ctx, req.Query, "images")
		if err != nil {
			p.Status, p.Problem = 503, "image search unavailable; use another source or host media capability"
			return p
		}
		var found struct {
			Results []struct {
				Title    string
				URL      string
				ImageURL string `json:"img_src"`
			}
		}
		if json.Unmarshal(raw, &found) != nil {
			p.Status, p.Problem = 503, "invalid image search response"
			return p
		}
		seen := map[string]bool{}
		for _, item := range found.Results {
			if !activityPublicURL(item.URL) || !activityPublicURL(item.ImageURL) || seen[item.ImageURL] {
				continue
			}
			seen[item.ImageURL] = true
			p.Candidates = append(p.Candidates, activityImageCandidate{managedSourceText(item.Title, 180), item.ImageURL, item.URL})
			if len(p.Candidates) == 8 {
				break
			}
		}
		if len(p.Candidates) == 0 {
			p.Problem = "no image candidates; change search terms or use host media"
		}
		return p
	}
	var source struct {
		SourceURL string `json:"source_url"`
		Title     string `json:"title"`
	}
	if json.Unmarshal(req.Data, &source) != nil || !activityPublicURL(req.URL) || !activityPublicURL(source.SourceURL) || strings.TrimSpace(source.Title) == "" {
		p.Status, p.Problem = 400, "select an image_url and provide data={source_url,title} from the source"
		return p
	}
	raw, _, err := activityFetchPublicContent(ctx, req.URL, 6<<20, true)
	if err == nil {
		p.Content, err = cleanManagedPhoto(raw)
	}
	if err != nil {
		p.Status, p.Problem = 422, "image could not be downloaded or decoded; select another candidate"
		return p
	}
	p.SourceURL, p.Title = source.SourceURL, managedSourceText(source.Title, 180)
	return p
}

func (s *Service) activityImage(ctx context.Context, c *app.RequestContext, req activityRequest) {
	p := req.preparedImage
	if p == nil {
		fail(c, 503, "IMAGE_UNAVAILABLE", "图片暂不可用", nil)
		return
	}
	if p.Status != 200 {
		fail(c, p.Status, "IMAGE_UNAVAILABLE", p.Problem, nil)
		return
	}
	if len(p.Content) == 0 {
		reply(c, 200, map[string]any{"candidates": p.Candidates, "media": []socialMedia{}, "found": false, "reason": p.Problem, "next": "Choose a relevant candidate, call image with url=image_url and data={source_url,title}; then use returned media in publish.", "untrusted": true})
		return
	}
	agent, _ := agentID(c)
	tx := s.db.WithContext(ctx)
	encoded := base64.StdEncoding.EncodeToString(p.Content)
	var id int64
	if err := tx.Raw(`SELECT media_id FROM social_media WHERE agent_id=? AND content_type='image/jpeg' AND content=decode(?,'base64') LIMIT 1`, agent, encoded).Scan(&id).Error; err != nil {
		s.socialFailure(c, err)
		return
	}
	if id == 0 {
		var used int64
		if err := tx.Raw(`SELECT COALESCE(sum(octet_length(content)),0) FROM social_media WHERE agent_id=?`, agent).Scan(&used).Error; err != nil {
			s.socialFailure(c, err)
			return
		}
		if used+int64(len(p.Content)) > 32<<20 {
			s.socialFailure(c, errors.New("media storage quota reached"))
			return
		}
		var err error
		id, err = s.idgen.NextID()
		if err == nil {
			err = insertPreparedMedia(tx, id, agent, p.Content, "image/jpeg")
		}
		if err != nil {
			s.socialFailure(c, err)
			return
		}
	}
	media := []socialMedia{{URL: socialMediaPrefix + fmtRun(id), Alt: p.Title, Kind: "image", Credit: "图片来源：" + p.SourceURL}}
	reply(c, 200, map[string]any{"media": media, "found": true, "source_page": p.SourceURL})
}
