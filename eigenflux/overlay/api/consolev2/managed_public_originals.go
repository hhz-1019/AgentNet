package consolev2

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"gorm.io/gorm"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

func publicPersonalHost(host string) bool {
	if host == "syndication.twitter.com" {
		return true
	}
	for _, p := range celebrityCatalog() {
		for _, f := range append(append([]string{}, p.OriginalFeeds...), p.OfficialSites...) {
			u, e := url.Parse(f)
			if e == nil && u.Hostname() == host {
				return true
			}
		}
	}
	return false
}

var publicNextData = regexp.MustCompile(`(?s)<script id="__NEXT_DATA__"[^>]*>(.*?)</script>`)

func parsePublicTimeline(raw []byte, handle string, now time.Time) ([]managedSource, error) {
	match := publicNextData.FindSubmatch(raw)
	if len(match) != 2 {
		return nil, errors.New("timeline unavailable")
	}
	var data struct {
		Props struct {
			PageProps struct {
				Timeline *struct {
					Entries []struct {
						Type    string `json:"type"`
						Content struct {
							Tweet struct {
								ID      string `json:"id_str"`
								Text    string `json:"full_text"`
								Created string `json:"created_at"`
								User    struct {
									ScreenName string `json:"screen_name"`
								} `json:"user"`
								Retweeted json.RawMessage `json:"retweeted_status"`
							} `json:"tweet"`
						} `json:"content"`
					} `json:"entries"`
				} `json:"timeline"`
			} `json:"pageProps"`
		} `json:"props"`
	}
	if json.Unmarshal(match[1], &data) != nil || data.Props.PageProps.Timeline == nil {
		return nil, errors.New("timeline unavailable")
	}
	out := []managedSource{}
	for _, entry := range data.Props.PageProps.Timeline.Entries {
		t := entry.Content.Tweet
		if entry.Type != "tweet" || !strings.EqualFold(t.User.ScreenName, handle) || len(t.Retweeted) > 0 || strings.HasPrefix(t.Text, "RT @") || t.ID == "" || t.Text == "" {
			continue
		}
		stamp, e := time.Parse("Mon Jan 02 15:04:05 -0700 2006", t.Created)
		if e != nil || stamp.After(now.Add(time.Hour)) {
			continue
		}
		out = append(out, managedSource{Title: managedSourceText(t.Text, 130), Summary: managedSourceText(t.Text, 1400), URL: "https://x.com/" + url.PathEscape(handle) + "/status/" + url.PathEscape(t.ID), Published: stamp.UTC().Format(time.RFC3339), Kind: "self_post", Author: handle})
	}
	return out, nil
}
func parsePublicOriginalFeed(raw []byte, feed, author string, now time.Time) ([]managedSource, error) {
	type item struct {
		Title       string `xml:"title"`
		Link        string `xml:"link"`
		Date        string `xml:"pubDate"`
		Description string `xml:"description"`
		Content     string `xml:"encoded"`
	}
	var doc struct {
		XMLName xml.Name
		Channel struct {
			Items []item `xml:"item"`
		} `xml:"channel"`
		Entries []struct {
			Title string `xml:"title"`
			Links []struct {
				Href string `xml:"href,attr"`
				Rel  string `xml:"rel,attr"`
			} `xml:"link"`
			Published string `xml:"published"`
			Updated   string `xml:"updated"`
			Content   string `xml:"content"`
			Summary   string `xml:"summary"`
		} `xml:"entry"`
	}
	if xml.Unmarshal(raw, &doc) != nil || (doc.XMLName.Local != "rss" && doc.XMLName.Local != "feed") {
		return nil, errors.New("invalid original feed")
	}
	rows := doc.Channel.Items
	for _, e := range doc.Entries {
		link := ""
		for _, l := range e.Links {
			if l.Rel == "alternate" || l.Rel == "" {
				link = l.Href
				break
			}
		}
		date := e.Published
		if date == "" {
			date = e.Updated
		}
		rows = append(rows, item{e.Title, link, date, e.Summary, e.Content})
	}
	base, _ := url.Parse(feed)
	out := []managedSource{}
	for _, r := range rows {
		u, e := url.Parse(r.Link)
		if e != nil {
			continue
		}
		u = base.ResolveReference(u)
		if u.Scheme == "http" && u.Hostname() == base.Hostname() {
			u.Scheme = "https"
		}
		if u.Hostname() != base.Hostname() || u.Scheme != "https" || u.User != nil {
			continue
		}
		var stamp time.Time
		for _, layout := range []string{time.RFC3339, time.RFC1123Z, time.RFC1123, time.RFC822Z} {
			if t, e := time.Parse(layout, r.Date); e == nil {
				stamp = t
				break
			}
		}
		if stamp.IsZero() || stamp.After(now.Add(time.Hour)) {
			continue
		}
		body := r.Content
		if body == "" {
			body = r.Description
		}
		out = append(out, managedSource{Title: managedSourceText(r.Title, 130), Summary: managedSourceText(body, 2400), URL: u.String(), Published: stamp.UTC().Format(time.RFC3339), Kind: "self_post", Author: author})
	}
	return out, nil
}
func fetchPublicOriginals(ctx context.Context, p celebrityProfile, now time.Time) ([]managedSource, string) {
	out := []managedSource{}
	success, failed, configured := 0, 0, 0
	for _, feed := range p.OriginalFeeds {
		configured++
		raw, e := publicSourceFetch(ctx, feed)
		if e != nil {
			failed++
			continue
		}
		items, e := parsePublicOriginalFeed(raw, feed, p.Name, now)
		if e != nil {
			failed++
			continue
		}
		success++
		out = append(out, items...)
	}
	for _, a := range p.Accounts {
		if a.Kind != "x" {
			continue
		}
		configured++
		raw, e := publicSourceFetch(ctx, "https://syndication.twitter.com/srv/timeline-profile/screen-name/"+url.PathEscape(a.Handle))
		if e != nil {
			failed++
			continue
		}
		items, e := parsePublicTimeline(raw, a.Handle, now)
		if e != nil {
			failed++
			continue
		}
		success++
		out = append(out, items...)
	}
	status := "ready"
	if configured == 0 {
		status = "no_public_feed"
	} else if success == 0 {
		status = "unavailable"
	} else if failed > 0 {
		status = "partial"
	}
	return out, status
}
func mergePublicOriginals(old string, fresh []managedSource) []managedSource {
	items := []managedSource{}
	_ = json.Unmarshal([]byte(old), &items)
	byURL := map[string]managedSource{}
	for _, v := range append(items, fresh...) {
		byURL[v.URL] = v
	}
	out := []managedSource{}
	for _, v := range byURL {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Published > out[j].Published })
	if len(out) > 200 {
		out = out[:200]
	}
	return out
}
func savePublicOriginals(tx *gorm.DB, owner, key string, old string, fresh []managedSource, status string, now time.Time) error {
	raw, _ := json.Marshal(mergePublicOriginals(old, fresh))
	checked := int64(0)
	if status == "ready" || status == "partial" {
		checked = now.UnixMilli()
	}
	return tx.Exec(`UPDATE managed_public_sources SET originals=?::jsonb,original_status=?,original_checked_at=CASE WHEN ?>0 THEN ? ELSE original_checked_at END WHERE sponsor_uid=? AND source_key=?`, string(raw), status, checked, checked, owner, key).Error
}
func (s *Service) celebrityOriginalSamples(ctx context.Context, job managedJob) []managedSource {
	p := celebrityForJob(job)
	if p == nil {
		return nil
	}
	var raw string
	if s.db.WithContext(ctx).Raw(`SELECT originals::text FROM managed_public_sources WHERE sponsor_uid=? AND source_key=?`, job.SponsorUID, p.Key).Scan(&raw).Error != nil {
		return nil
	}
	var items []managedSource
	_ = json.Unmarshal([]byte(raw), &items)
	if len(items) > 6 {
		items = items[:6]
	}
	for i := range items {
		items[i].Summary = managedSourceText(items[i].Summary, 900)
	}
	return items
}

var publicParagraph = regexp.MustCompile("(?is)<p(?:\\s[^>]*)?>(.*?)</p>")
var publicScripts = regexp.MustCompile("(?is)<(script|style)[^>]*>.*?</(?:script|style)>")

func fetchPublicBiography(ctx context.Context, p celebrityProfile, now time.Time) []map[string]any {
	out := []map[string]any{}
	for _, site := range p.OfficialSites {
		raw, e := publicSourceFetch(ctx, site)
		if e != nil {
			continue
		}
		clean := publicScripts.ReplaceAllString(string(raw), "")
		parts := []string{}
		for _, match := range publicParagraph.FindAllStringSubmatch(clean, 100) {
			text := managedSourceText(match[1], 1000)
			if len([]rune(text)) >= 35 {
				parts = append(parts, text)
			}
		}
		text := managedSourceText(strings.Join(parts, "\n"), 4000)
		if len([]rune(text)) < 100 {
			continue
		}
		out = append(out, map[string]any{"url": site, "observed_at": now.UnixMilli(), "text": text})
		if len(out) == 1 {
			break
		}
	}
	return out
}
