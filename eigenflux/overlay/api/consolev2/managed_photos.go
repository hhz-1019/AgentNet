package consolev2

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// Actual photographs, visually reviewed with their Commons attribution records.
//
//go:embed managed_photos/*.jpg managed_photos/catalog.json
var managedPhotoFiles embed.FS

type managedPhoto struct {
	ID         string `json:"id"`
	File       string `json:"file"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	Page       string `json:"page"`
	Author     string `json:"author"`
	License    string `json:"license"`
	LicenseURL string `json:"license_url"`
	Content    []byte `json:"-"`
}

var managedPhotoReject = regexp.MustCompile(`(?i)(painting|engraving|lithograph|watercolou?r|oil.on.canvas|rendering|diagram|screenshot|illustration|infographic|poster|logo|malicious|AI.generated|AI generated|synthetic|midjourney|stable.diffusion|dall.e|comfyui|trump|zelensky|president|prime minister)`)
var managedPhotoQuery = regexp.MustCompile(`^[a-zA-Z][a-zA-Z ,'-]{2,79}$`)

func photoURL(raw string, hosts ...string) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || len(raw) > 2000 {
		return false
	}
	for _, host := range hosts {
		if u.Hostname() == host {
			return true
		}
	}
	return false
}
func photoLicense(v string) bool {
	return v == "CC0" || v == "Public domain" || regexp.MustCompile(`^CC BY(-SA)? [1-4]\.0$`).MatchString(v)
}
func photoSafe(p managedPhoto) bool {
	return p.Title != "" && p.Author != "" && photoLicense(p.License) && photoURL(p.Page, "commons.wikimedia.org") && photoURL(p.URL, "upload.wikimedia.org", "thumb.wikimedia.org") && photoURL(p.LicenseURL, "creativecommons.org") && !managedPhotoReject.MatchString(p.Title)
}
func cleanManagedPhoto(raw []byte) ([]byte, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") || cfg.Width < 600 || cfg.Height < 350 || cfg.Width > 5000 || cfg.Height > 5000 || int64(cfg.Width)*int64(cfg.Height) > 16000000 {
		return nil, errors.New("photo dimensions or format")
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	if out.Len() > 4<<20 {
		return nil, errors.New("photo too large")
	}
	return out.Bytes(), nil
}
func managedPhotoTheme(d socialDocument, scene string) string {
	groups := []struct {
		key   string
		words []string
	}{
		{"accessibility", []string{"无障碍", "轮椅", "读屏"}}, {"laboratory", []string{"实验室", "生物", "化学", "实验器材"}},
		{"boardgame", []string{"桌游", "棋类", "解谜"}}, {"plants", []string{"植物", "园艺", "盆栽"}},
		{"museum", []string{"博物馆", "文物", "展览", "口述史"}}, {"city", []string{"漫步", "街区", "城市观察", "公园"}},
		{"reading", []string{"读书", "阅读", "书籍"}}, {"library", []string{"学习", "错题", "复习", "论文", "学术", "科研"}},
		{"coding", []string{"代码", "调试", "编程", "算法"}}, {"meeting", []string{"面试", "招聘", "求职", "交接", "团队", "协作", "分工"}},
		{"campus", []string{"校园", "交友", "社团", "聊天", "沟通边界"}}, {"coworking", []string{"创业", "原型", "产品", "需求"}},
	}
	for _, text := range []string{d.Title, d.Summary, d.Body} {
		for _, g := range groups {
			for _, word := range g.words {
				if strings.Contains(text, word) {
					return g.key
				}
			}
		}
	}
	switch managedSceneIndex(scene) {
	case 0:
		return "campus"
	case 1:
		return "meeting"
	case 2:
		return "coworking"
	case 3, 4:
		return "library"
	case 5:
		return "city"
	case 6:
		return "accessibility"
	default:
		return "museum"
	}
}
func curatedManagedPhoto(d socialDocument, scene string) (managedPhoto, error) {
	raw, err := managedPhotoFiles.ReadFile("managed_photos/catalog.json")
	if err != nil {
		return managedPhoto{}, err
	}
	var catalog []managedPhoto
	if err = json.Unmarshal(raw, &catalog); err != nil {
		return managedPhoto{}, err
	}
	theme := managedPhotoTheme(d, scene)
	for _, p := range catalog {
		if p.ID == theme {
			if !photoSafe(p) {
				return p, errors.New("invalid curated photo attribution")
			}
			raw, err := managedPhotoFiles.ReadFile("managed_photos/" + p.File)
			if err != nil {
				return p, err
			}
			p.Content, err = cleanManagedPhoto(raw)
			return p, err
		}
	}
	return managedPhoto{}, errors.New("no relevant photograph")
}

var photoCache = struct {
	sync.Mutex
	Values map[string]struct {
		At     time.Time
		Photos []managedPhoto
	}
}{Values: make(map[string]struct {
	At     time.Time
	Photos []managedPhoto
})}

func photoGET(ctx context.Context, raw string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "elsewhere/1.0 (https://elsewhere.twintalk.cn; community photo attribution)")
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("photo provider unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, (6<<20)+1))
	if len(body) > 6<<20 {
		return nil, errors.New("photo exceeds transfer limit")
	}
	return body, err
}
func searchManagedPhotos(ctx context.Context, query string) []managedPhoto {
	query = strings.TrimSpace(query)
	if !managedPhotoQuery.MatchString(query) {
		return nil
	}
	photoCache.Lock()
	cached, exists := photoCache.Values[query]
	photoCache.Unlock()
	if exists && len(cached.Photos) > 0 && time.Since(cached.At) < 6*time.Hour {
		return cached.Photos
	}
	q := url.Values{"action": {"query"}, "format": {"json"}, "generator": {"search"}, "gsrnamespace": {"6"}, "gsrlimit": {"40"}, "gsrsearch": {query + " filetype:bitmap -logo -diagram -poster -drawing -illustration -screenshot -president -AI-generated"}, "prop": {"imageinfo"}, "iiprop": {"url|extmetadata|metadata|size|mime"}, "iiurlwidth": {"1200"}}
	raw, err := photoGET(ctx, "https://commons.wikimedia.org/w/api.php?"+q.Encode())
	if err != nil {
		return nil
	}
	var response struct {
		Query struct {
			Pages map[string]struct {
				Title     string
				Index     int
				Imageinfo []struct {
					Thumburl       string
					Descriptionurl string
					Mime           string
					Width, Height  int
					Extmetadata    map[string]struct{ Value any }
					Metadata       []struct {
						Name  string
						Value any
					}
				}
			}
		}
	}
	if json.Unmarshal(raw, &response) != nil {
		return nil
	}
	type ranked struct {
		Index int
		Photo managedPhoto
	}
	rankedPhotos := []ranked{}
	for _, page := range response.Query.Pages {
		if len(page.Imageinfo) == 0 {
			continue
		}
		i := page.Imageinfo[0]
		if i.Mime != "image/jpeg" || i.Width < 600 || i.Height < 350 {
			continue
		}
		rawMeta := func(key string) string { value, _ := i.Extmetadata[key].Value.(string); return value }
		meta := func(key string) string { return managedSourceText(rawMeta(key), 400) }
		// EXIF is often stripped from legitimate photographs. Reject disallowed
		// visual subjects using the full source description instead.
		if managedPhotoReject.MatchString(rawMeta("Categories") + rawMeta("ImageDescription")) {
			continue
		}

		licenceURL := strings.Replace(meta("LicenseUrl"), "http://", "https://", 1)
		if meta("LicenseShortName") == "Public domain" && licenceURL == "" {
			licenceURL = "https://creativecommons.org/publicdomain/mark/1.0/"
		}
		u, err := url.Parse(i.Thumburl)
		if err != nil {
			continue
		}
		u.RawQuery = ""
		p := managedPhoto{Title: strings.TrimPrefix(page.Title, "File:"), URL: u.String(), Page: i.Descriptionurl, Author: meta("Artist"), License: meta("LicenseShortName"), LicenseURL: licenceURL}
		if photoSafe(p) {
			rankedPhotos = append(rankedPhotos, ranked{page.Index, p})
		}
	}
	sort.Slice(rankedPhotos, func(i, j int) bool { return rankedPhotos[i].Index < rankedPhotos[j].Index })
	photos := []managedPhoto{}
	for _, p := range rankedPhotos {
		photos = append(photos, p.Photo)
	}
	photoCache.Lock()
	if len(photoCache.Values) > 128 {
		clear(photoCache.Values)
	}
	photoCache.Values[query] = struct {
		At     time.Time
		Photos []managedPhoto
	}{time.Now(), photos}
	photoCache.Unlock()
	return photos
}
func selectManagedPhoto(ctx context.Context, d socialDocument, scene, query string, seed int64, excluded ...map[string]bool) (managedPhoto, error) {
	query = strings.TrimSpace(query)
	// Bound collection time; outages leave the post textual.
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if managedPhotoQuery.MatchString(query) {
		candidates := searchManagedPhotos(ctx, query)
		if len(candidates) > 0 {
			for _, p := range candidates {
				if !managedPhotoMatches(p, query) {
					continue
				}
				if len(excluded) > 0 && excluded[0][p.Page] {
					continue
				}
				raw, err := photoGET(ctx, p.URL)
				if err == nil {
					p.Content, err = cleanManagedPhoto(raw)
					if err == nil {
						return p, nil
					}
				}
				if ctx.Err() != nil {
					break
				}
			}
		}
	}
	// No generic stock fallback: a missing relevant photo is a text post.
	return managedPhoto{}, nil
}
func (s *Service) addManagedPhoto(tx *gorm.DB, agent int64, d *socialDocument, p managedPhoto) error {
	if len(p.Content) == 0 {
		return nil
	}
	if !photoSafe(p) || len(p.Content) == 0 {
		return errors.New("real photo required")
	}
	if _, format, err := image.DecodeConfig(bytes.NewReader(p.Content)); err != nil || format != "jpeg" {
		return errors.New("invalid photo content")
	}
	if err := tx.Exec(`SELECT agent_id FROM agents WHERE agent_id=? FOR UPDATE`, agent).Error; err != nil {
		return err
	}
	// Fingerprint normalized bytes across all managed roles.
	encoded := base64.StdEncoding.EncodeToString(p.Content)
	// Unique source and byte fingerprint claims serialize concurrent publishers.
	claim := tx.Exec(`INSERT INTO managed_photo_usage(source_page,content_hash) VALUES(?,md5(decode(?,'base64'))) ON CONFLICT DO NOTHING`, p.Page, encoded)
	if claim.Error != nil {
		return claim.Error
	}
	if claim.RowsAffected == 0 {
		return nil
	}
	var id int64
	if err := tx.Raw(`SELECT media_id FROM social_media WHERE agent_id=? AND content_type='image/jpeg' AND content=decode(?,'base64') LIMIT 1`, agent, encoded).Scan(&id).Error; err != nil {
		return err
	}
	if id == 0 {
		var used int64
		if err := tx.Raw(`SELECT COALESCE(sum(octet_length(content)),0) FROM social_media WHERE agent_id=?`, agent).Scan(&used).Error; err != nil {
			return err
		}
		if used+int64(len(p.Content)) > 32<<20 {
			return errors.New("managed media quota")
		}
		var err error
		id, err = s.idgen.NextID()
		if err != nil {
			return err
		}
		if err = insertPreparedMedia(tx, id, agent, p.Content, "image/jpeg"); err != nil {
			return err
		}
	}
	d.Media = []socialMedia{{URL: socialMediaPrefix + fmtRun(id), Alt: managedText("主题素材照片："+p.Title+"（非角色亲历或事件现场）", 290), Kind: "image"}}
	credit := "配图来源：" + p.Title + "；摄影/作者：" + p.Author + "；" + p.License + " " + p.LicenseURL + "；" + p.Page + "。主题素材照片，非角色本人或所述事件现场；缩放并转为 JPEG。"
	d.Media[0].Credit = credit
	if len([]rune(credit)) > 2000 {
		return errors.New("photo attribution exceeds limit")
	}
	return nil
}

// Retire legacy generated cards; intentional text posts remain textual.
func (s *Service) backfillManagedVisuals(ctx context.Context, c *app.RequestContext) {
	owner, ok := s.requireManaged(c)
	if !ok {
		return
	}
	var request struct {
		PostID   string `json:"post_id"`
		Query    string `json:"photo_query"`
		Remove   bool   `json:"remove"`
		Revision int64  `json:"revision"`
	}
	if len(c.Request.Body()) > 0 && json.Unmarshal(c.Request.Body(), &request) != nil {
		fail(c, 400, "INVALID_REQUEST", "补图请求无效", nil)
		return
	}
	if request.PostID != "" {
		if request.Remove {
			updated, err := s.removeManagedPostPhoto(ctx, owner, socialDecimal(request.PostID), request.Revision)
			if err != nil {
				s.managedError(c, err)
				return
			}
			reply(c, 200, map[string]any{"updated": updated})
			return
		}
		s.backfillManagedPostPhoto(ctx, c, owner, request.PostID, request.Query)
		return
	}
	var rows []struct {
		PostID, AgentID, Revision int64
		Document, Scenario        string
	}
	err := s.db.WithContext(ctx).Raw(`SELECT p.post_id,p.agent_id,p.revision,p.document::text AS document,m.scenario FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE m.sponsor_uid=? AND m.deleted_at=0 AND p.state='published' AND p.visibility='public' AND ((jsonb_array_length(p.document->'media')=1 AND p.document->'media'->0->>'kind'='chart' AND EXISTS(SELECT 1 FROM social_media sm WHERE sm.agent_id=p.agent_id AND sm.content_type='image/svg+xml' AND p.document->'media'->0->>'url'=?||sm.media_id::text))) ORDER BY p.post_id LIMIT 5`, owner, socialMediaPrefix).Scan(&rows).Error
	count := 0
	if err == nil {
		for _, row := range rows {
			var d socialDocument
			if err = json.Unmarshal([]byte(row.Document), &d); err != nil {
				break
			}
			var photo managedPhoto
			photo = managedPhoto{}
			if err != nil {
				break
			}
			err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				var current int64
				if err := tx.Raw(`SELECT p.revision FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE p.post_id=? AND m.sponsor_uid=? AND m.deleted_at=0 AND p.state='published' AND p.visibility='public' FOR UPDATE OF p`, row.PostID, owner).Scan(&current).Error; err != nil {
					return err
				}
				if current != row.Revision {
					return errConflict
				}
				d.Media = []socialMedia{}
				if err := s.addManagedPhoto(tx, row.AgentID, &d, photo); err != nil {
					return err
				}
				raw, _ := json.Marshal(d)
				if err := tx.Exec(`UPDATE social_work_posts SET document=?::jsonb,revision=revision+1,approved_revision=revision+1 WHERE post_id=?`, string(raw), row.PostID).Error; err != nil {
					return err
				}
				return managedAudit(tx, owner, "replace_photo", row.AgentID)
			})
			if err != nil {
				break
			}
			count++
		}
	}
	if err != nil {
		s.managedError(c, err)
		return
	}
	reply(c, 200, map[string]any{"updated": count})
}
