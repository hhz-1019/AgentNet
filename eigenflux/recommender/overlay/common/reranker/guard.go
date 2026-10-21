package reranker

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	_ "modernc.org/sqlite"
)

// Reservations are deliberately never refunded: timeouts and invalid responses
// can still be billed. The ledger and response cache survive container restarts.
var ErrRankingLimited = errors.New("ranking budget, cooldown or in-flight limit")

func guardLimit(name string, fallback int64) (int64, error) {
	value := os.Getenv(name)
	if value == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("invalid ranking limit %s", name)
	}
	return n, nil
}

func (c *Client) Rerank(ctx context.Context, req RerankRequest) (*RerankResponse, error) {
	if len(req.Documents) == 0 {
		return &RerankResponse{Model: req.Model}, nil
	}
	// One bounded batch, including for callers outside the worker pipeline.
	if len(req.Documents) > 30 || len(req.Query) > 12000 {
		return nil, ErrRankingLimited
	}
	reserved := int64(4096 + 2048) // maximum output plus protocol/instruction allowance
	queryJSON, _ := json.Marshal(req.Query)
	inputBytes := len(req.Query)
	for _, doc := range req.Documents {
		if len(doc) > 4000 {
			return nil, ErrRankingLimited
		}
		// Conservative UTF-8 byte accounting, including repeated query for rerank APIs.
		docJSON, _ := json.Marshal(doc)
		reserved += int64(len(queryJSON) + len(docJSON))
		inputBytes += len(doc)
	}
	if inputBytes > 100000 {
		return nil, ErrRankingLimited
	}
	callsLimit, err := guardLimit("RERANKER_DAILY_CALL_LIMIT", 60)
	if err != nil {
		return nil, err
	}
	tokensLimit, err := guardLimit("RERANKER_DAILY_TOKEN_LIMIT", 1000000)
	if err != nil {
		return nil, err
	}
	path := os.Getenv("RERANKER_BUDGET_DB")
	if path == "" {
		path = "/var/lib/gorse/ranking-guard.db"
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("ranking ledger unavailable")
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("ranking ledger unavailable")
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, `PRAGMA busy_timeout=5000`); err != nil {
		return nil, err
	}
	if _, err = conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS daily_budget(day TEXT PRIMARY KEY, calls INTEGER NOT NULL, tokens INTEGER NOT NULL);
	CREATE TABLE IF NOT EXISTS rank_cache(key TEXT PRIMARY KEY, expires INTEGER NOT NULL, response BLOB);`); err != nil {
		return nil, fmt.Errorf("ranking ledger unavailable")
	}
	encoded, _ := json.Marshal(struct {
		Endpoint string
		Request  RerankRequest
	}{c.url, req})
	key := fmt.Sprintf("%x", sha256.Sum256(encoded))
	now := time.Now()
	day := now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	// A write lock makes cache claim and budget reservation atomic across processes.
	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return nil, ErrRankingLimited
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	var expires int64
	var cached []byte
	err = conn.QueryRowContext(ctx, "SELECT expires, response FROM rank_cache WHERE key=?", key).Scan(&expires, &cached)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("ranking cache unavailable")
	}
	if err == nil && expires > now.Unix() {
		if len(cached) == 0 {
			return nil, ErrRankingLimited
		}
		var result RerankResponse
		if json.Unmarshal(cached, &result) != nil {
			return nil, fmt.Errorf("ranking cache invalid")
		}
		return &result, nil
	}
	_, err = conn.ExecContext(ctx, "INSERT OR IGNORE INTO daily_budget VALUES (?,0,0)", day)
	if err != nil {
		return nil, fmt.Errorf("ranking ledger unavailable")
	}
	update, err := conn.ExecContext(ctx, "UPDATE daily_budget SET calls=calls+1,tokens=tokens+? WHERE day=? AND calls<? AND tokens<=?", reserved, day, callsLimit, tokensLimit-reserved)
	if err != nil {
		return nil, fmt.Errorf("ranking ledger unavailable")
	}
	n, err := update.RowsAffected()
	if err != nil || n != 1 {
		return nil, ErrRankingLimited
	}
	// Crashes, partial responses and timeouts all get a persistent 30-minute cooldown.
	_, err = conn.ExecContext(ctx, "INSERT INTO rank_cache VALUES (?,?,NULL) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,response=NULL", key, now.Add(30*time.Minute).Unix())
	if err != nil {
		return nil, fmt.Errorf("ranking cache unavailable")
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return nil, fmt.Errorf("ranking reservation failed")
	}
	result, err := c.rerankUnbudgeted(ctx, req)
	if err != nil {
		return nil, err
	}
	encoded, err = json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if _, err = conn.ExecContext(ctx, "UPDATE rank_cache SET expires=?,response=? WHERE key=?", now.Add(6*time.Hour).Unix(), encoded, key); err != nil {
		return nil, fmt.Errorf("ranking cache write failed")
	}
	// Only hashes, scores and aggregate reservations are stored, never source text or keys.
	_, _ = conn.ExecContext(ctx, "DELETE FROM rank_cache WHERE expires<?", now.Unix())
	return result, nil
}
