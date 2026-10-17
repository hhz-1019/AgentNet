package cmd

import (
	"cli.eigenflux.ai/internal/auth"
	"context"
	"encoding/json"
	"errors"
	"github.com/spf13/cobra"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestElsewhereRegistrationWait(t *testing.T) {
	t.Run("completion resumes without waiting for cadence", func(t *testing.T) {
		reads := 0
		got, err := waitElsewhereRegistration(context.Background(), time.Second, time.Millisecond, func() (runtimeAccess, error) {
			reads++
			state := "in_progress"
			if reads == 3 {
				state = "completed"
			}
			return runtimeAccess{OnboardingState: state}, nil
		})
		if err != nil || got.OnboardingState != "completed" || reads != 3 {
			t.Fatalf("%+v %v reads=%d", got, err, reads)
		}
	})
	t.Run("ordinary plan remains a single read", func(t *testing.T) {
		reads := 0
		got, err := waitElsewhereRegistration(context.Background(), 0, time.Second, func() (runtimeAccess, error) {
			reads++
			return runtimeAccess{OnboardingState: "in_progress"}, nil
		})
		if err != nil || got.OnboardingState != "in_progress" || reads != 1 {
			t.Fatalf("%+v %v reads=%d", got, err, reads)
		}
	})
	t.Run("timeout is pending not completion", func(t *testing.T) {
		got, err := waitElsewhereRegistration(context.Background(), 3*time.Millisecond, time.Millisecond, func() (runtimeAccess, error) {
			return runtimeAccess{OnboardingState: "in_progress"}, nil
		})
		if err != nil || got.OnboardingState != "in_progress" {
			t.Fatalf("%+v %v", got, err)
		}
	})
	t.Run("offline is not ready", func(t *testing.T) {
		failure := errors.New("offline")
		got, err := waitElsewhereRegistration(context.Background(), time.Second, time.Millisecond, func() (runtimeAccess, error) {
			return runtimeAccess{}, failure
		})
		if !errors.Is(err, failure) || got.OnboardingState == "completed" {
			t.Fatalf("%+v %v", got, err)
		}
	})
	t.Run("host can stop waiting", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		_, err := waitElsewhereRegistration(ctx, time.Second, time.Second, func() (runtimeAccess, error) {
			cancel()
			return runtimeAccess{OnboardingState: "in_progress"}, nil
		})
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	})
}

func TestElsewhereCompanionPlan(t *testing.T) {
	prompt := elsewhereCyclePrompt("agentnet --homedir '/stable home' --server agentnet", []string{"agentnet-social/SKILL.md", "behavior.md", "activity.md", "daily-review.md"}, "completed")
	for _, expected := range []string{"/stable home", "agentnet-social", "同一身份档案", "用户归属", "activity.md", "daily-review.md", "actions.md", "host-context.md", "独立推进每日发帖", "已有任务与用户设置优先"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("missing companion contract: %s", expected)
		}
	}
	for _, forbidden := range []string{"ef-broadcast", "ef-profile", "Routine cycle completion alone does not warrant notification"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("upstream task rule leaked: %s", forbidden)
		}
	}
}

func TestElsewherePlanRefreshesRegistrationWithoutBusinessWrites(t *testing.T) {
	completed, reads := false, 0
	completeAt := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/api/v2/agent-context" {
			t.Errorf("unexpected business request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		reads++
		if completeAt > 0 && reads >= completeAt {
			completed = true
		}
		if !completed {
			w.WriteHeader(409)
			_, _ = w.Write([]byte(`{"error":{"code":"ONBOARDING_REQUIRED","details":{"onboarding_state":"in_progress"}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"context_revision":2}}`))
	}))
	defer srv.Close()
	cfg, _ := runtimeTestConfig(t, srv.URL, true)
	if err := cfg.AddServer("agentnet", srv.URL); err != nil {
		t.Fatal(err)
	}
	if err := auth.SaveV2Credentials("agentnet", &auth.V2Credentials{AgentID: "agent-1", AccessToken: "fixture", RefreshToken: "fixture", ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	t.Setenv("EIGENFLUX_SKILLS_DIR", dir)
	for _, name := range []string{"agentnet-social/SKILL.md", "agentnet-social/references/behavior.md", "agentnet-social/references/activity.md", "agentnet-social/references/daily-review.md", "agentnet-social/references/host-context.md", "agentnet-social/references/actions.md"} {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	oldFormat := formatFlag
	formatFlag = "json"
	t.Cleanup(func() { formatFlag = oldFormat })
	prefix := ""
	for _, state := range []string{"in_progress", "completed"} {
		completed = state == "completed"
		text, err := captureHeartbeatStdout(t, func() error { return elsewhereHeartbeatPlan(&cobra.Command{}) })
		if err != nil {
			t.Fatal(err)
		}
		var plan heartbeatPlan
		if err := json.Unmarshal([]byte(text), &plan); err != nil {
			t.Fatal(err)
		}
		if plan.Access.OnboardingState != state || !plan.WakeOnEmpty {
			t.Fatalf("fresh readiness lost: %+v", plan)
		}
		if prefix != "" && prefix != plan.CLIPrefix {
			t.Fatal("identity/Home changed")
		}
		prefix = plan.CLIPrefix
		if strings.Join(plan.ExecutionOrder, ",") != "settings,communication,feed,publish,owner_report" || len(plan.RuleSources) != 6 {
			t.Fatal("activity order or daily review rule missing")
		}
		if !strings.Contains(plan.SkillRevision, "daily-five-2026-10-17") || !strings.Contains(plan.SchedulerMigration, "replace the old task prompt") {
			t.Fatal("new publishing workflow must be identifiable and migrate the saved task")
		}
		if !strings.Contains(plan.SchedulerPrompt, "注册未完成时只检查准备状态") {
			t.Fatal("missing readiness guard")
		}
	}
	if reads != 2 {
		t.Fatalf("expected two fresh reads, got %d", reads)
	}
	// Real plan command waits on the authenticated readiness endpoint, then
	// returns the same identity's activity instructions without business writes.
	completed, completeAt = false, 4
	cmd := &cobra.Command{}
	cmd.Flags().Int("wait-seconds", 1, "")
	text, err := captureHeartbeatStdout(t, func() error { return elsewhereHeartbeatPlan(cmd) })
	if err != nil {
		t.Fatal(err)
	}
	var plan heartbeatPlan
	if err := json.Unmarshal([]byte(text), &plan); err != nil {
		t.Fatal(err)
	}
	if reads != 4 || plan.Access.OnboardingState != "completed" || plan.CLIPrefix != prefix || !strings.Contains(plan.AgentPrompt, "不等待两小时定时器") {
		t.Fatalf("first-round handoff failed: reads=%d plan=%+v", reads, plan)
	}
	for _, invalid := range []int{-1, 46} {
		cmd := &cobra.Command{}
		cmd.Flags().Int("wait-seconds", invalid, "")
		if err := elsewhereHeartbeatPlan(cmd); err == nil {
			t.Fatal("invalid observation duration accepted")
		}
	}
}
