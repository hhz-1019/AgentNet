package consolev2

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Local-only fixture server for real models running the production host loops.
// It never connects to the production database or accepts production credentials.
func TestManagedUnifiedHostsLive(t *testing.T) {
	if os.Getenv("AGENTNET_UNIFIED_LIVE") != "true" {
		t.Skip("explicit real-provider acceptance required")
	}
	dir := os.Getenv("AGENTNET_UNIFIED_REPORT_DIR")
	if dir == "" || !filepath.IsAbs(dir) {
		t.Fatal("absolute report directory required")
	}
	transport := http.DefaultTransport
	defer func() { http.DefaultTransport = transport }()
	traceFile, e := os.OpenFile(filepath.Join(dir, "managed-model.ndjson"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if e != nil {
		t.Fatal(e)
	}
	defer traceFile.Close()
	http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
		var input []byte
		if r.Body != nil {
			input, _ = io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(input))
		}
		res, e := transport.RoundTrip(r)
		if e == nil && strings.Contains(r.URL.Path, "chat/completions") {
			raw, _ := io.ReadAll(res.Body)
			res.Body.Close()
			res.Body = io.NopCloser(bytes.NewReader(raw))
			line, _ := json.Marshal(map[string]any{"at": time.Now().Format(time.RFC3339), "input": json.RawMessage(input), "output": json.RawMessage(raw), "status": res.StatusCode})
			traceFile.Write(append(line, '\n'))
		}
		return res, e
	})
	db := socialFixtureDB(t, os.Getenv("AGENTNET_MANAGED_TEST_DSN")).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	owner := "unified-live"
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES(?,987654229,'!x','!x',1)`, owner).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654229")
	s := &Service{db: db, idgen: &managedTestIDs{id: 369900000000000000}}
	// Existing personas and official source configurations, no invented scenario.
	celebrityIndex := 0
	for i, p := range celebrityCatalog() {
		if strings.Contains(p.English, "Andrew Ng") {
			celebrityIndex = i
			break
		}
	}
	entries := map[int]managedPersona{0: managedCatalog()[0], 25: managedCatalog()[25], 20000 + celebrityIndex: celebrityPersona(celebrityCatalog()[celebrityIndex]), 30001: recruitmentPersona(recruitmentBoards[1])}
	_, err := s.provisionManagedEntries(context.Background(), owner, entries)
	check(err)
	var jobs []managedJob
	check(db.Raw(`SELECT agent_id,seed_index,sponsor_uid,name,scenario,persona,revision FROM managed_members WHERE sponsor_uid=? ORDER BY seed_index`, owner).Scan(&jobs).Error)
	check(db.Exec(`UPDATE managed_campaigns SET enabled=true,monthly_budget_fen=100000,input_fen_per_million=1,output_fen_per_million=1 WHERE sponsor_uid=?; UPDATE managed_members SET enabled=true,start_hour=0,end_hour=24,daily_limit=12 WHERE sponsor_uid=?`, owner, owner).Error)
	for _, j := range jobs {
		activityFixtureGrants(t, db, j.AgentID)
	}
	// Register and run the real public-data adapters used by initialization.
	for _, j := range jobs {
		if p := celebrityForJob(j); p != nil {
			check(db.Exec("INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id) VALUES(?,?,'celebrity',?)", owner, p.Key, j.AgentID).Error)
		} else if j.SeedIndex != nil && *j.SeedIndex == 30001 {
			check(db.Exec("INSERT INTO managed_public_sources(sponsor_uid,source_key,kind,agent_id) VALUES(?,?,'recruitment',?)", owner, recruitmentBoards[1].Key, j.AgentID).Error)
			check(s.syncPublicSourceKey(context.Background(), owner, recruitmentBoards[1].Key, true))
		}
	}
	// First account exercises an external real-user host, not the managed adapter.
	check(db.Exec(`DELETE FROM managed_members WHERE agent_id=?; UPDATE agents SET agent_name='知遥' WHERE agent_id=?`, jobs[0].AgentID, jobs[0].AgentID).Error)
	jobs[0].Name = "知遥"
	check(db.Exec(`INSERT INTO agent_companions(agent_id,connection_goal,start_hour,end_hour,updated_at) VALUES(?,'寻找中国境内全程远程的 AI 产品、科技战略和科技投资实习',0,24,1) ON CONFLICT(agent_id) DO UPDATE SET start_hour=0,end_hour=24,connection_goal=EXCLUDED.connection_goal`, jobs[0].AgentID).Error)
	token := os.Getenv("AGENTNET_UNIFIED_TEST_TOKEN")
	if len(token) < 24 {
		t.Fatal("isolated server token required")
	}
	var mu sync.Mutex
	done := make(chan struct{})
	var once sync.Once
	rounds := []map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(401)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/finish" {
			once.Do(func() { close(done) })
			json.NewEncoder(w).Encode(map[string]bool{"ok": true})
			return
		}
		var req struct {
			AgentID string          `json:"agent_id"`
			Tool    string          `json:"tool"`
			Request activityRequest `json:"request"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "ACTIVITY_INVALID", "message": "arguments must match the tool schema; exclude_ids is an array of strings"}})
			return
		}
		id := socialDecimal(req.AgentID)
		var job *managedJob
		for i := range jobs {
			if jobs[i].AgentID == id {
				copy := jobs[i]
				job = &copy
			}
		}
		if job == nil {
			w.WriteHeader(404)
			return
		}
		if r.URL.Path == "/tool" {
			result, e := s.activityTool(r.Context(), id, req.Tool, req.Request)
			if e != nil {
				w.WriteHeader(500)
				json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
				return
			}
			w.WriteHeader(result.Status)
			w.Write(result.Data)
			return
		}
		if r.URL.Path != "/round" || id == jobs[0].AgentID {
			w.WriteHeader(404)
			return
		}
		job.RunID, _ = s.idgen.NextID()
		job.InputRate = 1
		job.OutputRate = 1
		job.Reserved = 1
		now := time.Now()
		day := now.Add(8 * time.Hour).UTC().Format("2006-01-02")
		if e := db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,?,?,?::date,?,'running',1,1,?)`, job.RunID, id, owner, day, day[:7], now.UnixMilli()).Error; e != nil {
			w.WriteHeader(500)
			return
		}
		runCtx, cancel := context.WithTimeout(r.Context(), 210*time.Second)
		s.executeManaged(runCtx, *job)
		cancel()
		var outcome struct {
			Status     string
			Detail     string
			ModelCalls int
		}
		if e := db.Raw("SELECT status,detail,model_calls FROM managed_runs WHERE run_id=?", job.RunID).Scan(&outcome).Error; e != nil {
			w.WriteHeader(500)
			return
		}
		memory, _ := s.activityTool(r.Context(), id, "recall", activityRequest{Scope: "public"})
		item := map[string]any{"agent_id": req.AgentID, "name": job.Name, "calls": outcome.ModelCalls, "action": outcome.Status, "detail": outcome.Detail, "continuation": activityData(memory)}
		if outcome.Status == "failed" || outcome.Status == "uncertain" {
			item["error"] = outcome.Detail
		}

		rounds = append(rounds, item)
		json.NewEncoder(w).Encode(item)
	}))
	defer srv.Close()
	// A compact model I/O trace is produced by the provider proxy in the harness.
	actors := []map[string]any{}
	for i, j := range jobs {
		kind := []string{"user", "fictional", "celebrity", "enterprise"}[i]
		actors = append(actors, map[string]any{"id": fmtRun(j.AgentID), "kind": kind, "name": j.Name})
	}
	ready, _ := json.Marshal(map[string]any{"url": srv.URL, "actors": actors})
	check(os.WriteFile(filepath.Join(dir, "ready.json"), ready, 0600))
	select {
	case <-done:
	case <-time.After(35 * time.Minute):
		t.Fatal("live harness timed out")
	}
	mu.Lock()
	defer mu.Unlock()
	var images []struct {
		MediaID int64
		Content []byte
	}
	check(db.Raw("SELECT media_id,content FROM social_media WHERE content_type='image/jpeg'").Scan(&images).Error)
	mediaChecks := []map[string]any{}
	check(os.MkdirAll(filepath.Join(dir, "images"), 0700))
	for _, item := range images {
		cfg, format, e := image.DecodeConfig(bytes.NewReader(item.Content))
		check(e)
		name := fmtRun(item.MediaID) + ".jpg"
		check(os.WriteFile(filepath.Join(dir, "images", name), item.Content, 0600))
		mediaChecks = append(mediaChecks, map[string]any{"url": socialMediaPrefix + fmtRun(item.MediaID), "file": "images/" + name, "width": cfg.Width, "height": cfg.Height, "format": format, "bytes": len(item.Content)})
	}
	var posts, comments, receipts, reviews string
	check(db.Raw(`SELECT COALESCE(jsonb_agg(x),'[]')::text FROM (SELECT p.post_id::text,p.agent_id::text,a.agent_name,p.document,p.state,p.visibility FROM social_work_posts p JOIN agents a USING(agent_id) ORDER BY p.post_id)x`).Scan(&posts).Error)
	check(db.Raw(`SELECT COALESCE(jsonb_agg(x),'[]')::text FROM (SELECT agent_id::text,operation_key,digest,tool,status,result,created_at FROM agent_activity_receipts ORDER BY created_at)x`).Scan(&receipts).Error)
	check(db.Raw(`SELECT COALESCE(jsonb_agg(x),'[]')::text FROM (SELECT agent_id::text,revision,day,intent,summary,evidence,updated_at FROM agent_activity_reviews)x`).Scan(&reviews).Error)
	check(db.Raw(`SELECT COALESCE(jsonb_agg(x),'[]')::text FROM (SELECT comment_id::text,post_id::text,agent_id::text,content,created_at FROM social_work_comments ORDER BY created_at)x`).Scan(&comments).Error)
	report, _ := json.MarshalIndent(map[string]any{"posts": json.RawMessage(posts), "comments": json.RawMessage(comments), "receipts": json.RawMessage(receipts), "reviews": json.RawMessage(reviews), "rounds": rounds, "production_writes": false, "verified_media": mediaChecks}, "", "  ")
	check(os.WriteFile(filepath.Join(dir, "results.json"), report, 0600))
}
