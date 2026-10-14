package consolev2

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	elasticsearch "github.com/elastic/go-elasticsearch/v8"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"eigenflux_server/pkg/es"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type erasureJob struct {
	JobID     string
	AgentIDs  pq.Int64Array  `gorm:"column:agent_ids;type:bigint[]"`
	ItemIDs   pq.Int64Array  `gorm:"column:item_ids;type:bigint[]"`
	RedisKeys pq.StringArray `gorm:"column:redis_keys;type:text[]"`
	CreatedAt int64
	Attempts  int
}

func (s *Service) accountErasureLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		if err := s.cleanErasureJobs(ctx); err != nil {
			log.Printf("account erasure queue: %v", err)
		}
		cancel()
	}
}

func (s *Service) cleanErasureJobs(ctx context.Context) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var jobs []erasureJob
		now := time.Now().UnixMilli()
		if err := tx.Raw(`SELECT * FROM account_erasure_jobs WHERE completed_at IS NULL AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED`, now).Scan(&jobs).Error; err != nil {
			return err
		}
		for _, job := range jobs {
			err := s.cleanErasureExternal(ctx, job)
			if err != nil {
				log.Printf("account erasure cleanup pending job=%s attempt=%d", job.JobID, job.Attempts+1)
			}
			// Sweep again after the maximum ordinary in-flight processing window; jobs
			// stay pending on any ES/Redis error and survive service restarts.
			if err == nil && job.Attempts > 0 && now-job.CreatedAt >= int64(24*time.Hour/time.Millisecond) {
				if e := tx.Exec(`UPDATE account_erasure_jobs SET completed_at=?,attempts=attempts+1 WHERE job_id=?`, now, job.JobID).Error; e != nil {
					return e
				}
			} else {
				delay := time.Minute
				if err == nil {
					delay = time.Hour
				}
				if e := tx.Exec(`UPDATE account_erasure_jobs SET attempts=attempts+1,next_attempt_at=? WHERE job_id=?`, now+int64(delay/time.Millisecond), job.JobID).Error; e != nil {
					return e
				}
			}
		}
		return nil
	})
}

func (s *Service) cleanErasureExternal(ctx context.Context, job erasureJob) error {
	if s.redisClient == nil {
		return errors.New("erasure cleanup services unavailable")
	}
	// The API process normally does not initialize the sort service's ES client.
	search := es.Client
	if search == nil {
		address := strings.TrimSpace(os.Getenv("ES_URL"))
		if address == "" {
			return errors.New("erasure search address unavailable")
		}
		var err error
		search, err = elasticsearch.NewClient(elasticsearch.Config{Addresses: []string{address}, Username: strings.TrimSpace(os.Getenv("ES_USERNAME")), Password: os.Getenv("ES_PASSWORD"), MaxRetries: 1, Transport: &http.Transport{ResponseHeaderTimeout: 5 * time.Second}})
		if err != nil {
			return errors.New("erasure search client unavailable")
		}
	}
	should := []any{map[string]any{"terms": map[string]any{"author_agent_id": decimalIDs(job.AgentIDs)}}}
	if len(job.ItemIDs) > 0 {
		should = append(should, map[string]any{"ids": map[string]any{"values": decimalIDs(job.ItemIDs)}})
	}
	body, _ := json.Marshal(map[string]any{"query": map[string]any{"bool": map[string]any{"should": should, "minimum_should_match": 1}}})
	response, err := search.DeleteByQuery([]string{es.ReadIndexPattern}, bytes.NewReader(body), search.DeleteByQuery.WithContext(ctx), search.DeleteByQuery.WithRefresh(true), search.DeleteByQuery.WithConflicts("proceed"))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.IsError() {
		return fmt.Errorf("search cleanup status %d", response.StatusCode)
	}
	var result struct {
		TimedOut         bool              `json:"timed_out"`
		VersionConflicts int64             `json:"version_conflicts"`
		Failures         []json.RawMessage `json:"failures"`
	}
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
		return err
	}
	if result.TimedOut || result.VersionConflicts > 0 || len(result.Failures) > 0 {
		return errors.New("search cleanup incomplete")
	}
	if len(job.RedisKeys) > 0 {
		if err := s.redisClient.Del(ctx, job.RedisKeys...).Err(); err != nil {
			return err
		}
	}
	for _, name := range []string{"agentcard:last_active", "agentcard:influence_percentile", "agentcard:influence_snapshot"} {
		if len(job.AgentIDs) > 0 {
			if err := s.redisClient.HDel(ctx, name, decimalIDs(job.AgentIDs)...).Err(); err != nil {
				return err
			}
		}
	}
	patterns := []string{"cache:search:*", "feed:cache:*", "console:v2:home:*"}
	for _, id := range append(decimalIDs(job.AgentIDs), decimalIDs(job.ItemIDs)...) {
		patterns = append(patterns, "*:"+id, "*:"+id+":*", "*:{"+id+"}:*")
	}
	for _, pattern := range patterns {
		var cursor uint64
		for {
			keys, next, e := s.redisClient.Scan(ctx, cursor, pattern, 100).Result()
			if e != nil {
				return e
			}
			if len(keys) > 0 {
				if e = s.redisClient.Del(ctx, keys...).Err(); e != nil {
					return e
				}
			}
			cursor = next
			if cursor == 0 {
				break
			}
		}
	}
	return nil
}

// Record only cache addresses before source rows disappear; peers' caches are
// invalidated and rebuilt, never their authoritative account data.
func erasureCacheKeys(tx *gorm.DB, ids []int64) ([]string, error) {
	keys := []string{}
	var hashes []string
	if err := tx.Raw("SELECT token_hash FROM agent_sessions WHERE agent_id=ANY(?)", pq.Array(ids)).Scan(&hashes).Error; err != nil {
		return nil, err
	}
	for _, h := range hashes {
		keys = append(keys, "auth:session:"+h)
	}
	var emails []string
	if err := tx.Raw("SELECT email FROM agents WHERE agent_id=ANY(?)", pq.Array(ids)).Scan(&emails).Error; err != nil {
		return nil, err
	}
	for _, email := range emails {
		keys = append(keys, fmt.Sprintf("auth:login:email:active:%x", sha256.Sum256([]byte(email))))
	}
	var convs []struct{ ConvID, ParticipantA, ParticipantB, OriginID int64 }
	if err := tx.Raw("SELECT conv_id,participant_a,participant_b,COALESCE(origin_id,0) AS origin_id FROM conversations WHERE participant_a=ANY(?) OR participant_b=ANY(?)", pq.Array(ids), pq.Array(ids)).Scan(&convs).Error; err != nil {
		return nil, err
	}
	var peers []int64
	if err := tx.Raw("SELECT to_uid FROM user_relations WHERE from_uid=ANY(?) UNION SELECT from_uid FROM user_relations WHERE to_uid=ANY(?)", pq.Array(ids), pq.Array(ids)).Scan(&peers).Error; err != nil {
		return nil, err
	}
	for _, c := range convs {
		keys = append(keys, fmt.Sprintf("pm:conv:%d", c.ConvID), fmt.Sprintf("pm:convmap:%d:%d:%d", c.ParticipantA, c.ParticipantB, c.OriginID))
		peers = append(peers, c.ParticipantA, c.ParticipantB)
	}
	for _, id := range peers {
		for _, format := range []string{"friend:%d", "friend_count:%d", "block:%d", "pm:fetch:%d"} {
			keys = append(keys, fmt.Sprintf(format, id))
		}
	}
	return keys, nil
}
