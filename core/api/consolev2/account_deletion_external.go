package consolev2

import (
	"bytes"
	"context"
	"elsewhere_server/pkg/es"
	"elsewhere_server/pkg/testaccountreset"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/elastic/go-elasticsearch/v8"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Fail closed: reservations remain until every configured store acknowledges
// erasure. A read-only index or version conflict must never count as success.
func (s *Service) eraseAccountExternal(ctx context.Context, p accountErasure) error {
	if s.redisClient == nil {
		return errors.New("erasure stores unavailable")
	}
	// The normal API process does not initialize the search RPC's global client.
	// Create a transport locally; never change global ES state from a worker.
	search := es.Client
	if search == nil {
		endpoint := strings.TrimSpace(os.Getenv("ES_URL"))
		if endpoint == "" {
			return errors.New("erasure search store is not configured")
		}
		var err error
		transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second}
		defer transport.CloseIdleConnections()
		search, err = elasticsearch.NewClient(elasticsearch.Config{Addresses: []string{endpoint},
			Username: os.Getenv("ES_USERNAME"), Password: os.Getenv("ES_PASSWORD"),
			Transport: transport, DisableRetry: true})
		if err != nil {
			return err
		}
	}
	for _, query := range []struct {
		index, field string
		ids          []int64
	}{
		{es.ReadIndexPattern, "author_agent_id", p.Agents},
		{commissionErasureIndex(), "seller_agent_id", p.Agents},
	} {
		if len(query.ids) == 0 {
			continue
		}
		body, _ := json.Marshal(map[string]any{"query": map[string]any{"terms": map[string]any{query.field: query.ids}}})
		res, err := search.DeleteByQuery([]string{query.index}, bytes.NewReader(body),
			search.DeleteByQuery.WithContext(ctx), search.DeleteByQuery.WithRefresh(true),
			search.DeleteByQuery.WithIgnoreUnavailable(true), search.DeleteByQuery.WithAllowNoIndices(true))
		if err != nil {
			return err
		}
		err = checkErasureIndexResult(res.StatusCode, res.Body)
		res.Body.Close()
		if err != nil {
			return err
		}
	}
	if len(p.Keys) > 0 {
		if err := s.redisClient.Del(ctx, p.Keys...).Err(); err != nil {
			return err
		}
	}
	for _, hash := range testaccountreset.RedisHashes {
		if len(p.Agents) == 0 {
			break
		}
		if err := s.redisClient.HDel(ctx, hash, agentStrings(p.Agents)...).Err(); err != nil {
			return err
		}
	}
	// Cached search/feed pages can contain another account's text. These are
	// disposable projections; invalidating them preserves peers' source data.
	for _, pattern := range []string{"cache:search:*", "feed:cache:*", "cache:profile:*", "pm:fetch:*"} {
		it := s.redisClient.Scan(ctx, 0, pattern, 200).Iterator()
		for it.Next(ctx) {
			if err := s.redisClient.Del(ctx, it.Val()).Err(); err != nil {
				return err
			}
		}
		if err := it.Err(); err != nil {
			return err
		}
	}
	// Queue entries retain payloads after ACK. Delete only matching entries,
	// including dead-letter copies, without trimming anyone else's messages.
	it := s.redisClient.Scan(ctx, 0, "stream:*", 100).Iterator()
	for it.Next(ctx) {
		key := it.Val()
		start := "-"
		for {
			rows, err := s.redisClient.XRangeN(ctx, key, start, "+", 200).Result()
			if err != nil {
				return err
			}
			if len(rows) == 0 {
				break
			}
			for _, row := range rows {
				if erasurePayloadMatches(row.Values, p) {
					if err = s.redisClient.XDel(ctx, key, row.ID).Err(); err != nil {
						return err
					}
				}
			}
			start = "(" + rows[len(rows)-1].ID
		}
	}
	if err := it.Err(); err != nil {
		return err
	}
	if endpoint := strings.TrimSpace(os.Getenv("AGENTNET_GORSE_URL")); endpoint != "" {
		g := socialGorseClient{endpoint, os.Getenv("AGENTNET_GORSE_API_KEY")}
		for _, id := range p.Agents {
			if err := g.request(ctx, "DELETE", "/api/user/"+url.PathEscape(fmt.Sprint("agent:", id)), nil, nil); err != nil {
				return err
			}
		}
		for _, id := range p.Posts {
			if err := g.request(ctx, "DELETE", "/api/item/"+url.PathEscape(fmt.Sprint("post:", id)), nil, nil); err != nil {
				return err
			}
		}
	}
	return nil
}
func commissionErasureIndex() string {
	if index := os.Getenv("COMMISSION_INDEX_NAME"); index != "" {
		return index
	}
	return "commissions-*"
}
func checkErasureIndexResult(status int, body io.Reader) error {
	var result struct {
		TimedOut         bool              `json:"timed_out"`
		VersionConflicts int64             `json:"version_conflicts"`
		Failures         []json.RawMessage `json:"failures"`
		Total            *int64            `json:"total"`
		Deleted          *int64            `json:"deleted"`
	}
	if status >= 300 || json.NewDecoder(io.LimitReader(body, 1<<20)).Decode(&result) != nil ||
		result.TimedOut || result.VersionConflicts != 0 || len(result.Failures) != 0 ||
		result.Total == nil || result.Deleted == nil || *result.Total != *result.Deleted {
		return errors.New("search erasure incomplete")
	}
	return nil
}
func erasurePayloadMatches(value any, p accountErasure) bool {
	switch v := value.(type) {
	case map[string]interface{}:
		for key, entry := range v {
			ids := []int64{}
			switch key {
			case "agent_id", "author_agent_id", "sender_id", "receiver_id", "buyer_agent_id", "seller_agent_id", "target_agent_id":
				ids = p.Agents
			case "item_id":
				ids = p.Items
			case "post_id":
				ids = p.Posts
			case "service_id", "commission_id":
				ids = p.Services
			}
			for _, id := range ids {
				if fmt.Sprint(entry) == fmt.Sprint(id) {
					return true
				}
			}
			if erasurePayloadMatches(entry, p) {
				return true
			}
		}
	case []interface{}:
		for _, entry := range v {
			if erasurePayloadMatches(entry, p) {
				return true
			}
		}
	case string:
		if strings.HasPrefix(v, "{") || strings.HasPrefix(v, "[") {
			var parsed any
			d := json.NewDecoder(strings.NewReader(v))
			d.UseNumber()
			if d.Decode(&parsed) == nil {
				return erasurePayloadMatches(parsed, p)
			}
		}
	}
	return false
}
