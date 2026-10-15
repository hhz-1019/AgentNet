package consolev2

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagedModelFailureClassificationAndUsage(t *testing.T) {
	t.Setenv("LLM_BASE_URL", "https://api.deepseek.com")
	t.Setenv("LLM_MODEL", "deepseek-flash")
	t.Setenv("LLM_API_KEY", "fixture-secret-never-log")
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	for _, tc := range []struct {
		name       string
		status     int
		body, code string
		known      bool
		tokens     int64
	}{
		{"balance", 402, `{"error":"fixture-secret-never-log"}`, "provider_402", true, 0},
		{"busy", 503, `{"error":"fixture-secret-never-log"}`, "provider_503", false, 0},
		{"throttle", 429, `{}`, "provider_429", true, 0},
		{"truncated", 200, `{"choices":[{"finish_reason":"length","message":{"content":"{"}}],"usage":{"prompt_tokens":400,"completion_tokens":1500}}`, "output_length", true, 400},
		{"invalid json", 200, `{"choices":[{"finish_reason":"stop","message":{"content":"not json"}}],"usage":{"prompt_tokens":100,"completion_tokens":20}}`, "output", true, 100},
		{"keep alive", 200, "\n\n" + `{"choices":[{"finish_reason":"stop","message":{"content":"{\"action\":\"skip\"}"}}],"usage":{"prompt_tokens":0,"completion_tokens":0}}`, "", true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			http.DefaultTransport = managedTransport(func(r *http.Request) (*http.Response, error) {
				body, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(body), `"thinking":{"type":"disabled"}`) {
					t.Fatal("thinking unexpectedly enabled")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})
			r, err := callManagedModel(context.Background(), map[string]string{"topic": "fixture"})
			if (tc.code == "" && err != nil) || (tc.code != "" && (err == nil || managedFailureCode(err) != tc.code)) {
				t.Fatal(err)
			}
			if !r.Requested || r.UsageKnown != tc.known || r.Input != tc.tokens {
				t.Fatal(r)
			}
			if err != nil && strings.Contains(err.Error(), "fixture-secret") {
				t.Fatal("provider data leaked")
			}
		})
	}
	http.DefaultTransport = managedTransport(func(*http.Request) (*http.Response, error) { return nil, context.DeadlineExceeded })
	r, err := callManagedModel(context.Background(), map[string]string{"topic": "fixture"})
	if managedFailureCode(err) != "provider_timeout" || !r.Requested {
		t.Fatal(r, err)
	}
	r, err = callManagedModel(context.Background(), map[string]string{"api_key": "secret-value"})
	if managedFailureCode(err) != "input" || r.Requested {
		t.Fatal("preflight reached provider", r, err)
	}
	job := managedJob{Reserved: 12, InputRate: 200, OutputRate: 800}
	for _, tc := range []struct {
		r    managedModelResult
		want int64
	}{
		{managedModelResult{}, 0},
		{managedModelResult{Requested: true}, 12},
		{managedModelResult{Requested: true, UsageKnown: true}, 0},
		{managedModelResult{Requested: true, UsageKnown: true, Input: 1000, Output: 100}, 1},
	} {
		if got := managedResultCost(job, tc.r); got != tc.want {
			t.Fatal(got, tc.want)
		}
	}
}

func TestManagedFailureReceiptsAndProviderCooldown(t *testing.T) {
	dsn := os.Getenv("AGENTNET_MANAGED_TEST_DSN")
	if dsn == "" {
		t.Skip("full schema required")
	}
	db := socialFixtureDB(t, dsn).Begin()
	defer db.Rollback()
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.Exec("UPDATE managed_campaigns SET enabled=false").Error)
	check(insertProvisionedAgent(db, 96001, "failure@identity.invalid", "failure", 1))
	check(db.Exec(`INSERT INTO human_accounts(uid,account_number,password_hash,recovery_hash,created_at) VALUES('failure-sponsor',987654311,'!x','!x',1),('failure-member',987654312,'!x','!x',1);
INSERT INTO managed_campaigns(sponsor_uid,enabled,monthly_budget_fen,input_fen_per_million,output_fen_per_million) VALUES('failure-sponsor',true,10000,200,800);
INSERT INTO managed_members(agent_id,owner_uid,sponsor_uid,seed_index,name,scenario,persona,enabled,daily_limit,start_hour,end_hour,next_run_at,pending_topic) VALUES(96001,'failure-member','failure-sponsor',0,'failure','学习互助','fixture',true,12,0,24,0,'明确选题');`).Error)
	t.Setenv("AGENTNET_MANAGED_ADMIN_UIDS", "987654311")
	s := &Service{db: db, idgen: &managedTestIDs{id: 96500}}
	now := time.Now()
	day := now.UTC().Add(8 * time.Hour).Format("2006-01-02")
	month := day[:7]
	job := managedJob{AgentID: 96001, SponsorUID: "failure-sponsor", Reserved: 12, InputRate: 200, OutputRate: 800}
	for i := int64(1); i <= 3; i++ {
		job.RunID = 96100 + i
		check(db.Exec(`INSERT INTO managed_runs(run_id,agent_id,sponsor_uid,day,month,status,reserved_fen,charged_fen,created_at) VALUES(?,96001,'failure-sponsor',?::date,?,'running',12,12,?)`, job.RunID, day, month, now.UnixMilli()+i).Error)
		s.finishManagedFailure(job, managedModelResult{Requested: true}, managedFailure("provider_timeout"))
	}
	claimed, err := s.claimManaged(context.Background(), now.Add(time.Second))
	check(err)
	if claimed != nil {
		t.Fatal("provider failure cascaded into another account")
	}
	check(db.Exec("UPDATE managed_runs SET finished_at=? WHERE sponsor_uid='failure-sponsor'", now.Add(-11*time.Minute).UnixMilli()).Error)
	claimed, err = s.claimManaged(context.Background(), now.Add(time.Second))
	check(err)
	if claimed == nil {
		t.Fatal("cooldown did not recover")
	}
	s.finishManagedFailure(*claimed, managedModelResult{Requested: true, UsageKnown: true, Input: 1000, Output: 100}, errors.New("SQL contains private credential"))
	var receipt struct {
		Detail                  string
		ChargedFen, InputTokens int64
	}
	check(db.Raw("SELECT detail,charged_fen,input_tokens FROM managed_runs WHERE run_id=?", claimed.RunID).Scan(&receipt).Error)
	if receipt.ChargedFen != 1 || receipt.InputTokens != 1000 || strings.Contains(receipt.Detail, "credential") || !strings.HasPrefix(receipt.Detail, "[publish]") {
		t.Fatal(receipt)
	}
}
