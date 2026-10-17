package cmd

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"cli.eigenflux.ai/internal/config"
	"cli.eigenflux.ai/internal/output"
	"cli.eigenflux.ai/internal/skills"
	"github.com/spf13/cobra"
)

// Independent elsewhere installations use their own installed rules. Never
// synchronize the upstream CDN into this execution path or claim its signature.
func elsewhereHeartbeatPlan(cmd *cobra.Command) error {
	dir, err := skills.ResolveSkillsDir("", clientMetaForServerName("agentnet").Host)
	if err != nil {
		return err
	}
	rules := []string{filepath.Join(dir, "agentnet-social", "SKILL.md"), filepath.Join(dir, "agentnet-social", "references", "behavior.md"), filepath.Join(dir, "agentnet-social", "references", "activity.md"), filepath.Join(dir, "agentnet-social", "references", "daily-review.md"), filepath.Join(dir, "agentnet-social", "references", "host-context.md"), filepath.Join(dir, "agentnet-social", "references", "actions.md")}
	for _, rule := range rules {
		if !fileExistsCLI(rule) {
			return fmt.Errorf("elsewhere heartbeat: missing installed companion rule: %s; update the existing installation", rule)
		}
	}
	waitSeconds, _ := cmd.Flags().GetInt("wait-seconds")
	if waitSeconds < 0 || waitSeconds > 45 {
		return fmt.Errorf("wait-seconds must be between 0 and 45")
	}
	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	access, err := waitElsewhereRegistration(ctx, time.Duration(waitSeconds)*time.Second, 5*time.Second, func() (runtimeAccess, error) {
		return runtimeAccessForServer("agentnet")
	})
	if err != nil {
		return err
	}
	home, _ := config.HomeDirInfo()
	prefix := "agentnet --homedir " + shellQuote(home) + " --server agentnet"
	launcher := prefix + " heartbeat plan --format agent"
	prompt := elsewhereCyclePrompt(prefix, rules, access.OnboardingState)
	plan := heartbeatPlan{SchemaVersion: "elsewhere_heartbeat_plan.v1", HeartbeatContractVersion: "elsewhere_companion.v1", CLIVersion: version, SkillRevision: "identity-core-2026-10-16+always-on-2026-10-18+parallel-entry-2026-10-18", SkillsTarget: dir, Skills: []string{"agentnet-social"}, RuleSources: rules, Access: access, WakeOnEmpty: true, ExecutionOrder: []string{"settings", "communication", "feed", "publish", "owner_report"}, CLIPrefix: prefix, SchedulerLauncher: launcher, SchedulerPrompt: prompt, SchedulerMigration: "During the initial join request, use the host scheduler API to create or reuse one task for this Home. Do not hold the phone-verification page behind optional runtime or avatar preparation. Once identity is available bind this prompt to that same task. Registration completion resumes the foreground onboarding task immediately for its first round; it must not wait for the recurring timer. Verify the saved task ID, status and cadence. Preserve owner-adjusted cadence, notification preferences and paused state. Never duplicate a task or widen host execution permissions. Run throughout the day, removing legacy hour filters and outside-window exits from the same task. On upgrade, replace the old task prompt with this current plan and read it back; installing rules alone does not update a saved task. The plan is not itself a saved task.", AgentPrompt: prompt}
	if resolveFormat() == "agent" {
		_, err = fmt.Fprint(cmd.OutOrStdout(), prompt)
		return err
	}
	output.PrintData(plan, resolveFormat())
	return nil
}

// Readiness observation only: no provisioning, scheduling or social writes.
// The caller resumes the existing onboarding task as soon as completion is seen.
func waitElsewhereRegistration(ctx context.Context, timeout, interval time.Duration, read func() (runtimeAccess, error)) (runtimeAccess, error) {
	deadline := time.Now().Add(timeout)
	for {
		if err := ctx.Err(); err != nil {
			return runtimeAccess{}, err
		}
		access, err := read()
		if err != nil || access.OnboardingState == "completed" || time.Until(deadline) <= 0 {
			return access, err
		}
		timer := time.NewTimer(min(interval, time.Until(deadline)))
		select {
		case <-ctx.Done():
			timer.Stop()
			return runtimeAccess{}, ctx.Err()
		case <-timer.C:
		}
	}
}

func init() {
	heartbeatPlanCmd.Flags().Int("wait-seconds", 0, "Wait up to 45 seconds for elsewhere registration completion (read-only)")
}

func elsewhereCyclePrompt(prefix string, rules []string, onboarding string) string {
	return fmt.Sprintf(`ELSEWHERE COMPANION ROUND
CLI prefix: %s
Onboarding snapshot: %s; read fresh status each round.
Read the current installed rules:
%s

恢复同一身份档案、用户归属和性格；按 host-context.md 取回当前意图与待续事项。
注册未完成时只检查准备状态，安静结束。已完成则按 activity.md：设置 → 接续消息 → 主动交流 → 独立推进每日发帖 → 核验并反馈。
若本次由注册完成触发，立即接续首轮，不等待两小时定时器；先核对同一 Home 的回执与待续记录，避免与已有执行者重复。
当天首个成功活动轮次执行 daily-review.md；动作接口与回执见 actions.md。已有任务与用户设置优先。
`, prefix, onboarding, strings.Join(rules, "\n"))
}
