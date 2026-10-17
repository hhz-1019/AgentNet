package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"gorm.io/gorm"
)

// This adapter does not rank. Gorse owns retrieval/ranking; Elsewhere owns
// authorization and the Agent owns interpretation of the current host intent.
const socialGorseVersion = "gorse-0.5.11"

type socialGorseClient struct{ endpoint, key string }

// Keep upstream URLs, credentials, user metadata and response bodies out of logs.
type socialGorseError struct {
	Stage  string
	Status int
	Cause  error
}

func (e *socialGorseError) Error() string { return "recommendation service unavailable: " + e.Stage }
func (e *socialGorseError) Unwrap() error { return e.Cause }
func socialGorseStage(method, path string) string {
	switch {
	case strings.HasPrefix(path, "/api/recommend/"):
		return "recommend"
	case strings.Contains(path, "feedback"):
		return "feedback_" + strings.ToLower(method)
	default:
		return "user_" + strings.ToLower(method)
	}
}

func (g socialGorseClient) request(ctx context.Context, method, path string, input, output any) (result error) {
	started := time.Now()
	status := 0
	defer func() {
		if result == nil {
			return
		}
		stage := socialGorseStage(method, path)
		cause := result
		result = &socialGorseError{Stage: stage, Status: status, Cause: cause}
		// A missing viewer is a normal first-visit case, not an outage.
		if status == http.StatusNotFound && stage == "user_get" {
			return
		}
		category := "transport"
		if status != 0 {
			category = "upstream_status"
		}
		if status >= 200 && status < 300 {
			category = "invalid_response"
		}
		if errors.Is(cause, context.DeadlineExceeded) {
			category = "timeout"
		}
		if errors.Is(cause, context.Canceled) {
			category = "canceled"
		}
		slog.Warn("recommendation request failed", "stage", stage, "status", status, "kind", category, "elapsed_ms", time.Since(started).Milliseconds())
	}()
	var body io.Reader
	if input != nil {
		b, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(g.endpoint, "/")+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", g.key)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	status = resp.StatusCode
	if method == "DELETE" && resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("recommendation service rejected request")
	}
	if output != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(output)
	}
	_, err = io.Copy(io.Discard, io.LimitReader(resp.Body, 2<<20))
	return err
}

type socialGorseFeedback struct {
	FeedbackType, UserId, ItemId string
	Timestamp                    string
}

func (s *Service) syncSocialGorseViewer(ctx context.Context, g socialGorseClient, viewer int64) (int, error) {
	count := 0
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var found int64
		if err := tx.Raw("SELECT agent_id FROM agents WHERE agent_id=? FOR KEY SHARE", viewer).Scan(&found).Error; err != nil {
			return err
		}
		if found == 0 {
			return errUnauthorized
		}
		scoped := &Service{db: tx}
		var err error
		count, err = scoped.syncLiveGorseViewer(ctx, g, viewer)
		return err
	})
	return count, err
}
func (s *Service) syncLiveGorseViewer(ctx context.Context, g socialGorseClient, viewer int64) (int, error) {
	prefs, err := s.readSocialPreferences(ctx, viewer)
	if err != nil {
		return 0, err
	}
	user := "agent:" + strconv.FormatInt(viewer, 10)
	var stored struct{ Labels []string }
	err = g.request(ctx, "GET", "/api/user/"+url.PathEscape(user), nil, &stored)
	var upstream *socialGorseError
	missing := errors.As(err, &upstream) && upstream.Status == http.StatusNotFound
	if err != nil && !missing {
		return 0, err
	}
	if missing || !slices.Equal(stored.Labels, prefs.Tags) {
		if err = g.request(ctx, "POST", "/api/user", map[string]any{"UserId": user, "Labels": prefs.Tags}, nil); err != nil {
			return 0, err
		}
	}
	// Transfer only actual likes/saves on public posts. No synthetic clicks,
	// inferred owner approval, or host memories are used as training feedback.
	var rows []struct {
		PostID int64
		Kind   string
	}
	err = s.db.WithContext(ctx).Raw(`SELECT r.post_id,r.kind FROM social_work_reactions r JOIN social_work_posts p ON p.post_id=r.post_id WHERE r.agent_id=? AND p.state='published' AND p.visibility='public' AND p.agent_id<>? AND r.kind IN ('like','save') FOR KEY SHARE OF p`, viewer, viewer).Scan(&rows).Error
	if err != nil {
		return 0, err
	}
	current := map[string]bool{}
	feedback := []socialGorseFeedback{}
	for _, r := range rows {
		id := "post:" + strconv.FormatInt(r.PostID, 10)
		current[r.Kind+":"+id] = true
		feedback = append(feedback, socialGorseFeedback{r.Kind, user, id, time.Now().UTC().Format(time.RFC3339)})
	}
	var old []socialGorseFeedback
	if err = g.request(ctx, "GET", "/api/user/"+url.PathEscape(user)+"/feedback", nil, &old); err != nil {
		return 0, err
	}
	existing := map[string]bool{}
	for _, f := range old {
		existing[f.FeedbackType+":"+f.ItemId] = true
		if (f.FeedbackType == "like" || f.FeedbackType == "save") && !current[f.FeedbackType+":"+f.ItemId] {
			if err = g.request(ctx, "DELETE", "/api/feedback/"+f.FeedbackType+"/"+url.PathEscape(user)+"/"+url.PathEscape(f.ItemId), nil, nil); err != nil {
				return 0, err
			}
		}
	}
	// Existing feedback must not invalidate recommendation caches on every read.
	missingFeedback := []socialGorseFeedback{}
	for _, f := range feedback {
		if !existing[f.FeedbackType+":"+f.ItemId] {
			missingFeedback = append(missingFeedback, f)
		}
	}
	if len(missingFeedback) > 0 {
		if err = g.request(ctx, "POST", "/api/feedback", missingFeedback, nil); err != nil {
			return 0, err
		}
	}
	return len(feedback), nil
}

func (s *Service) getSocialOpportunities(ctx context.Context, c *app.RequestContext) {
	viewer, _ := agentID(c)
	endpoint := strings.TrimSpace(os.Getenv("AGENTNET_GORSE_URL"))
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		fail(c, 503, "RECOMMENDATIONS_UNAVAILABLE", "推荐暂时不可用", nil)
		return
	}
	if c.Query("cursor") != "" || c.Query("intent") != "" {
		fail(c, 400, "INVALID_RECOMMENDATION_QUERY", "当轮意图由宿主 Agent 判断；下一批使用已读帖子列表", nil)
		return
	}
	var excluded []string
	if raw := c.Query("exclude_ids"); raw != "" {
		if json.Unmarshal([]byte(raw), &excluded) != nil || len(excluded) > 200 {
			fail(c, 400, "INVALID_EXCLUSIONS", "已读帖子列表无效", nil)
			return
		}
	}
	excludedSet := map[int64]bool{}
	for _, id := range excluded {
		n, e := strconv.ParseInt(id, 10, 64)
		if e != nil || n <= 0 {
			fail(c, 400, "INVALID_EXCLUSIONS", "已读帖子列表无效", nil)
			return
		}
		excludedSet[n] = true
	}
	var tags []string
	if raw := c.Query("tags"); raw != "" {
		if json.Unmarshal([]byte(raw), &tags) != nil || len(tags) > 8 {
			fail(c, 400, "INVALID_TAGS", "筛选标签无效", nil)
			return
		}
	}
	q := strings.TrimSpace(c.Query("q"))
	if len([]rune(q)) > 100 {
		fail(c, 400, "INVALID_QUERY", "搜索内容过长", nil)
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	g := socialGorseClient{endpoint, os.Getenv("AGENTNET_GORSE_API_KEY")}
	count, err := s.syncSocialGorseViewer(ctx, g, viewer)
	if err != nil {
		s.socialRecommendationFailure(c, err)
		return
	}
	var ranked []string
	err = g.request(ctx, "GET", "/api/recommend/"+url.PathEscape("agent:"+strconv.FormatInt(viewer, 10))+"?n=500", nil, &ranked)
	if err != nil {
		s.socialRecommendationFailure(c, err)
		return
	}
	if len(ranked) > 500 {
		s.socialFailure(c, errors.New("recommendation response exceeded requested size"))
		return
	}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, id := range ranked {
		if !strings.HasPrefix(id, "post:") {
			continue
		}
		n, e := strconv.ParseInt(strings.TrimPrefix(id, "post:"), 10, 64)
		if e == nil && n > 0 && !seen[n] && !excludedSet[n] {
			ids = append(ids, n)
			seen[n] = true
		}
	}
	rows := []socialPostRow{}
	if len(ids) > 0 {
		// A stale Gorse index is never an authorization source. Hydrate only currently
		// public, visible posts; preserve Gorse's ordering after these access filters.
		where := ` WHERE ` + socialAccess + ` AND p.state='published' AND p.visibility='public' AND p.agent_id<>? AND p.post_id IN ?`
		args := []any{viewer, viewer, viewer, viewer, viewer, viewer, viewer, viewer, viewer, ids}
		if q != "" {
			where += ` AND (p.document->>'title' ILIKE ? OR p.document->>'summary' ILIKE ? OR p.document->>'body' ILIKE ?)`
			pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
			args = append(args, pattern, pattern, pattern)
		}
		if len(tags) > 0 {
			b, _ := json.Marshal(tags)
			where += ` AND p.document->'tags' @> ?::jsonb`
			args = append(args, string(b))
		}
		if err = s.db.WithContext(ctx).Raw(socialSelect+where, args...).Scan(&rows).Error; err != nil {
			s.socialFailure(c, err)
			return
		}
	}
	byID := map[int64]socialPostRow{}
	for _, r := range rows {
		byID[r.PostID] = r
	}
	selected := []socialPostRow{}
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			selected = append(selected, r)
			if len(selected) == 20 {
				break
			}
		}
	}
	s.addSocialImagePreviews(ctx, selected)
	items := []map[string]any{}
	for _, r := range selected {
		items = append(items, socialView(r))
	}
	// Having feedback does not prove a personalized model is ready. Expose only
	// the observed input state, not an inferred training/cold-start status.
	reply(c, 200, map[string]any{"items": items, "next_cursor": "", "ranking_version": socialGorseVersion, "continuation": "exclude_ids", "feedback_count": count, "has_feedback": count > 0, "intent_handling": "host_agent", "candidate_count": len(ranked)})
}

func (s *Service) socialRecommendationFailure(c *app.RequestContext, err error) {
	var upstream *socialGorseError
	if errors.As(err, &upstream) {
		fail(c, 503, "RECOMMENDATIONS_UNAVAILABLE", "推荐暂时不可用", nil)
		return
	}
	s.socialFailure(c, err)
}
