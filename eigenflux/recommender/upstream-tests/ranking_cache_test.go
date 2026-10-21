package worker

import (
	"fmt"
	"github.com/gorse-io/gorse/config"
	"github.com/gorse-io/gorse/storage/cache"
	"github.com/gorse-io/gorse/storage/data"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"time"
)

func (suite *WorkerTestSuite) TestElsewhereColdStartCacheAndFailureFallback() {
	t := suite.T()
	ctx := t.Context()
	t.Setenv("RERANKER_BUDGET_DB", filepath.Join(t.TempDir(), "ledger.db"))
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; http.Error(w, "unavailable", 503) }))
	defer server.Close()
	suite.Config.Recommend.Ranker.Type = "llm"
	suite.Config.Recommend.Ranker.RerankerAPI.URL = server.URL
	suite.Config.Recommend.Ranker.QueryTemplate = "{{ user.Comment }}"
	suite.Config.Recommend.Ranker.DocumentTemplate = "{{ item.Comment }}"
	suite.Config.Recommend.Ranker.Recommenders = []string{"item-to-item/topics", "latest"}
	suite.Config.Recommend.ItemToItem = []config.ItemToItemConfig{{Name: "topics", Type: "tags", Column: "item.Labels.tags"}}
	user := data.User{UserId: "cold-start", Comment: "photography"}
	suite.Require().NoError(suite.DataClient.BatchInsertUsers(ctx, []data.User{user}))
	var items []data.Item
	var scores []cache.Score
	for i := range 50 {
		id := fmt.Sprint(i)
		items = append(items, data.Item{ItemId: id, Comment: "photo", Timestamp: time.Now()})
		scores = append(scores, cache.Score{Id: id, Score: float64(50 - i), Categories: []string{""}})
	}
	suite.Require().NoError(suite.DataClient.BatchInsertItems(ctx, items))
	suite.Require().NoError(suite.CacheClient.AddScores(ctx, cache.NonPersonalized, "latest", scores))
	suite.Require().NoError(suite.CacheClient.Set(ctx, cache.Time(cache.Key(cache.LastModifyUserTime, user.UserId), time.Now().Add(-time.Hour))))
	suite.Recommend(ctx, []data.User{user}, nil)
	suite.Equal(1, calls)
	result, err := suite.CacheClient.SearchScores(ctx, cache.Recommend, user.UserId, nil, 0, -1)
	suite.Require().NoError(err)
	suite.Len(result, 30)
	suite.False(suite.checkRecommendCacheOutOfDate(ctx, user.UserId), "cold-start digest must match even when topics has no candidates")
	suite.Recommend(ctx, []data.User{user}, nil)
	suite.Equal(1, calls, "failure fallback must be cached instead of re-running")
	// A real configuration change still invalidates cached recommendations.
	suite.Config.Recommend.ItemToItem[0].Column = "item.Labels.other"
	suite.True(suite.checkRecommendCacheOutOfDate(ctx, user.UserId))
}
