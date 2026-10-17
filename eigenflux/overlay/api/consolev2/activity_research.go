package consolev2

import (
	"context"
	"encoding/xml"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"golang.org/x/net/html"
)

func activityPublicURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && (u.Port() == "" || u.Port() == "443") && len(raw) <= 2000 && !socialSecretPattern.MatchString(raw)
}
func activityPublicIP(ip net.IP) bool {
	for _, block := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2001::/32", "2002::/16", "64:ff9b::/96"} {
		_, network, _ := net.ParseCIDR(block)
		if network.Contains(ip) {
			return false
		}
	}
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified()
}

// Resolve and validate at connection time, then dial the vetted address. No
// environment proxy, ambient cookies or credentials; every redirect is rechecked.
func activityFetchPublic(ctx context.Context, raw string) ([]byte, string, error) {
	if !activityPublicURL(raw) {
		return nil, "", errors.New("public HTTPS URL required")
	}
	transport := &http.Transport{TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 8 * time.Second, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, errors.New("no public address")
		}
		for _, ip := range ips {
			if !activityPublicIP(ip.IP) {
				return nil, errors.New("nonpublic address blocked")
			}
		}
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 12 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 || !activityPublicURL(req.URL.String()) {
			return errors.New("redirect blocked")
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "elsewhere-agent-research/1.0")
	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, "", errors.New("source unavailable")
	}
	typ := res.Header.Get("Content-Type")
	if !strings.HasPrefix(typ, "text/") && !strings.Contains(typ, "xml") && !strings.Contains(typ, "json") {
		return nil, "", errors.New("source is not text")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, "", errors.New("source too large")
	}
	return data, res.Request.URL.String(), nil
}

func activityPageText(data []byte) string {
	z := html.NewTokenizer(strings.NewReader(string(data)))
	var out strings.Builder
	skip := 0
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt == html.StartTagToken || tt == html.EndTagToken {
			name, _ := z.TagName()
			tag := string(name)
			if tag == "script" || tag == "style" || tag == "noscript" {
				if tt == html.StartTagToken {
					skip++
				} else if skip > 0 {
					skip--
				}
			}
		}
		if tt == html.TextToken && skip == 0 {
			out.Write(z.Text())
			out.WriteByte(' ')
		}
		if out.Len() > 24000 {
			break
		}
	}
	return managedSourceText(out.String(), 6000)
}
func (s *Service) activityResearch(ctx context.Context, c *app.RequestContext, name string, req activityRequest) {
	rawURL := req.URL
	if name == "sources" {
		q := strings.TrimSpace(req.Query)
		if q == "" || len([]rune(q)) > 160 || socialSecretPattern.MatchString(q) {
			fail(c, 400, "RESEARCH_QUERY", "请提供简短的公开检索词", nil)
			return
		}
		rawURL = "https://news.google.com/rss/search?q=" + url.QueryEscape(q) + "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
	}
	data, finalURL, err := activityFetchPublic(ctx, rawURL)
	if err != nil {
		fail(c, 503, "RESEARCH_UNAVAILABLE", "这次未能读取来源，可换一个来源或保留待续事项", nil)
		return
	}
	if name == "sources" {
		var feed struct {
			Channel struct {
				Items []struct {
					Title       string `xml:"title"`
					Link        string `xml:"link"`
					Description string `xml:"description"`
					Date        string `xml:"pubDate"`
				} `xml:"item"`
			} `xml:"channel"`
		}
		if xml.Unmarshal(data, &feed) != nil {
			fail(c, 503, "RESEARCH_UNAVAILABLE", "来源格式暂不可读取", nil)
			return
		}
		items := []managedSource{}
		for _, item := range feed.Channel.Items {
			if !activityPublicURL(item.Link) {
				continue
			}
			stamp, _ := time.Parse(time.RFC1123Z, item.Date)
			if stamp.IsZero() {
				stamp, _ = time.Parse(time.RFC1123, item.Date)
			}
			items = append(items, managedSource{ID: fmtRun(int64(len(items) + 1)), Title: managedSourceText(item.Title, 160), URL: item.Link, Summary: managedSourceText(item.Description, 700), Published: stamp.UTC().Format(time.RFC3339), Kind: "news"})
			if len(items) == 6 {
				break
			}
		}
		reply(c, 200, map[string]any{"items": items, "scope": "news_search", "full_text": false})
		return
	}
	text := activityPageText(data)
	if strings.TrimSpace(text) == "" {
		fail(c, 503, "RESEARCH_UNAVAILABLE", "网页没有可读取正文", nil)
		return
	}
	reply(c, 200, map[string]any{"url": finalURL, "text": text, "fetched_at": time.Now().UnixMilli(), "publication_date_verified": false, "untrusted": true})
}
