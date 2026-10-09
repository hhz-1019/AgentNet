package consolev2

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

type managedSource struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Published string `json:"published"`
	Summary   string `json:"summary"`
}

var managedFeedURLs = []string{"https://news.mit.edu/rss/topic/education", "https://feeds.bbci.co.uk/news/education/rss.xml", "https://sspai.com/feed", "https://www.nature.com/nature.rss", "https://news.mit.edu/rss/topic/innovation"}
var managedFeedHosts = map[string]bool{"news.mit.edu": true, "www.bbc.com": true, "www.bbc.co.uk": true, "bbc.com": true, "bbc.co.uk": true, "sspai.com": true, "www.nature.com": true, "nature.com": true}
var managedHTMLTag = regexp.MustCompile(`<[^>]*>`)

func managedSourceText(v string, max int) string {
	v = html.UnescapeString(managedHTMLTag.ReplaceAllString(v, " "))
	v = strings.Join(strings.Fields(v), " ")
	r := []rune(v)
	if len(r) > max {
		v = string(r[:max])
	}
	return v
}
func managedSourceURL(v string) bool {
	u, e := url.Parse(v)
	return e == nil && u.Scheme == "https" && u.User == nil && u.Port() == "" && len(v) <= 300 && managedFeedHosts[strings.ToLower(u.Hostname())] && !socialSecretPattern.MatchString(v)
}
func parseManagedSources(raw []byte, now time.Time) []managedSource {
	type item struct {
		Title       string `xml:"title"`
		Link        string `xml:"link"`
		Date        string `xml:"pubDate"`
		DCDate      string `xml:"date"`
		Description string `xml:"description"`
		Content     string `xml:"encoded"`
	}
	var feed struct {
		Channel struct {
			Items []item `xml:"item"`
		} `xml:"channel"`
		Items []item `xml:"item"`
	}
	if xml.Unmarshal(raw, &feed) != nil {
		return []managedSource{}
	}
	out := []managedSource{}
	seen := map[string]bool{}
	for _, it := range append(feed.Channel.Items, feed.Items...) {
		stamp := it.Date
		if stamp == "" {
			stamp = it.DCDate
		}
		var date time.Time
		for _, layout := range []string{time.RFC1123Z, time.RFC1123, time.RFC3339, time.RFC822Z, "2006-01-02"} {
			if d, e := time.Parse(layout, stamp); e == nil {
				date = d
				break
			}
		}
		link := strings.TrimSpace(it.Link)
		if date.IsZero() || date.After(now.Add(time.Hour)) || date.Before(now.Add(-14*24*time.Hour)) || !managedSourceURL(link) || seen[link] {
			continue
		}
		title := managedSourceText(it.Title, 130)
		summary := managedSourceText(it.Description, 400)
		if summary == "" {
			summary = managedSourceText(it.Content, 400)
		}
		if title == "" || socialSecretPattern.MatchString(title+summary) || managedPrivatePattern.MatchString(title+summary) {
			continue
		}
		seen[link] = true
		out = append(out, managedSource{Title: title, URL: link, Published: date.UTC().Format(time.RFC3339), Summary: summary})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Published > out[j].Published })
	if len(out) > 15 {
		out = out[:15]
	}
	return out
}
func (s *Service) managedSources(ctx context.Context, scene string) []managedSource {
	index := managedSceneIndex(scene)
	if index < 0 {
		return nil
	}
	choices := [][]int{{0, 2}, {0, 4}, {4, 2}, {0, 2}, {3, 0}, {2}, {2}, {0}}
	sources := []managedSource{}
	now := time.Now()
	for _, feedIndex := range choices[index] {
		feed := managedFeedURLs[feedIndex]
		var cached struct {
			FetchedAt int64
			Items     string
			Status    string
		}
		if s.db.WithContext(ctx).Raw(`SELECT fetched_at,items::text,status FROM managed_source_cache WHERE feed_url=?`, feed).Scan(&cached).Error != nil {
			continue
		}
		items := []managedSource{}
		if cached.FetchedAt > now.Add(-30*time.Minute).UnixMilli() {
			_ = json.Unmarshal([]byte(cached.Items), &items)
		} else {
			fetchCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			req, _ := http.NewRequestWithContext(fetchCtx, http.MethodGet, feed, nil)
			req.Header.Set("User-Agent", "elsewhere-community/1.0 (+https://agentnet.zeabur.app)")
			client := &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			res, err := client.Do(req)
			state := "unavailable"
			if err == nil {
				if res.StatusCode == 200 {
					raw, e := io.ReadAll(io.LimitReader(res.Body, 2<<20))
					if e == nil {
						items = parseManagedSources(raw, now)
						if len(items) > 0 {
							state = "ready"
						} else {
							state = "no_recent_items"
						}
					}
				}
				res.Body.Close()
			}
			cancel()
			raw, _ := json.Marshal(items)
			s.db.WithContext(ctx).Exec(`INSERT INTO managed_source_cache(feed_url,fetched_at,items,status) VALUES(?,?,?::jsonb,?) ON CONFLICT(feed_url) DO UPDATE SET fetched_at=EXCLUDED.fetched_at,items=EXCLUDED.items,status=EXCLUDED.status`, feed, now.UnixMilli(), string(raw), state)
		}
		// Recheck freshness even for cached records.
		for _, item := range items {
			date, e := time.Parse(time.RFC3339, item.Published)
			if e == nil && date.After(now.Add(-14*24*time.Hour)) && managedSourceURL(item.URL) {
				sources = append(sources, item)
			}
		}
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].Published > sources[j].Published })
	if len(sources) > 4 {
		sources = sources[:4]
	}
	for i := range sources {
		sources[i].ID = fmtRun(int64(i + 1))
	}
	return sources
}
