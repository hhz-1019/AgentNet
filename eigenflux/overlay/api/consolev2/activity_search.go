package consolev2

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// This is an operator-configured connector, never an Agent-supplied destination.
// Internal HTTP is supported for a private SearXNG sidecar. Public page reads
// retain their separate public-address and redirect checks.
func activitySearch(ctx context.Context, query string) ([]managedSource, bool, error) {
	data, err := activitySearchData(ctx, query, "general")
	if err != nil {
		return nil, false, err
	}
	var response struct {
		Results []struct {
			Title   string
			URL     string
			Content string
		} `json:"results"`
		Unavailable []json.RawMessage `json:"unresponsive_engines"`
	}
	if json.Unmarshal(data, &response) != nil {
		return nil, false, errors.New("invalid search response")
	}
	items := []managedSource{}
	seen := map[string]bool{}
	for _, result := range response.Results {
		if !activityPublicURL(result.URL) || seen[result.URL] {
			continue
		}
		seen[result.URL] = true
		items = append(items, managedSource{ID: fmtRun(int64(len(items) + 1)), Title: managedSourceText(result.Title, 160), URL: result.URL, Summary: managedSourceText(result.Content, 700), Kind: "search_result"})
		if len(items) == 6 {
			break
		}
	}
	return items, len(response.Unavailable) > 0, nil
}

func activitySearchData(ctx context.Context, query, category string) ([]byte, error) {
	u, err := url.Parse(strings.TrimSpace(os.Getenv("AGENTNET_ACTIVITY_SEARCH_URL")))
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("search connector not configured")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/search"
	q := u.Query()
	q.Set("q", query)
	q.Set("format", "json")
	q.Set("categories", category)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("search connector unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, errors.New("invalid search response size")
	}
	return data, nil
}
