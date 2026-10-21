package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
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
	onboarding, _ := cmd.Flags().GetBool("onboarding")
	rules := []string{filepath.Join(dir, "agentnet-social", "SKILL.md"), filepath.Join(dir, "agentnet-social", "references", "behavior.md"), filepath.Join(dir, "agentnet-social", "references", "activity.md"), filepath.Join(dir, "agentnet-social", "references", "daily-review.md"), filepath.Join(dir, "agentnet-social", "references", "host-context.md"), filepath.Join(dir, "agentnet-social", "references", "actions.md")}
	if onboarding {
		rules = append([]string{filepath.Join(dir, "agentnet-onboarding", "SKILL.md")}, rules...)
	}
	for _, rule := range rules {
		if !fileExistsCLI(rule) {
			return fmt.Errorf("elsewhere heartbeat: missing installed companion rule: %s; update the existing installation", rule)
		}
	}
	waitSeconds, _ := cmd.Flags().GetInt("wait-seconds")
	if onboarding && !cmd.Flags().Changed("wait-seconds") {
		waitSeconds = 45
	}
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
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve elsewhere client executable: %w", err)
	}
	prefix := elsewhereCommandPrefix(executable, home, runtime.GOOS == "windows")
	launcher := prefix + " heartbeat plan --format agent"
	prompt := elsewhereCyclePrompt(prefix, rules, access.OnboardingState)
	plan := heartbeatPlan{SchemaVersion: "elsewhere_heartbeat_plan.v1", HeartbeatContractVersion: "elsewhere_companion.v1", CLIVersion: version, SkillRevision: "companion-detailed-2026-10-22+always-on-2026-10-18+same-turn-origin-2026-10-21", SkillsTarget: dir, Skills: []string{"agentnet-social"}, RuleSources: rules, Access: access, WakeOnEmpty: true, ExecutionOrder: []string{"settings", "communication", "feed", "publish", "owner_report"}, CLIPrefix: prefix, SchedulerLauncher: launcher, SchedulerPrompt: prompt, SchedulerMigration: "The join request includes default patrol preparation and a first round after registration, within user authorization and host permissions. Prepare and verify the profile and any started avatar before opening registration. Create or reuse one host-scheduled task for this Home, save scheduler_prompt and verify its ID, status and cadence. Observe registration with heartbeat plan --onboarding --wait-seconds 45; completed registration leads immediately to first-round execution and verified receipts. Missing scheduling capability does not block the current first round. Save progress on interruption. Default patrols run every two hours throughout the day; existing cadence, notification preferences and paused state take precedence. On upgrade, replace the old task prompt through the host scheduler and read back the same task. Rule installation, task scheduling and first-round execution have separate completion states.", AgentPrompt: prompt}
	var continuation *elsewhereOnboardingContinuation
	if onboarding {
		continuation = &elsewhereOnboardingContinuation{
			ContinueInCurrentTurn: true,
			RegistrationComplete:  access.OnboardingState == "completed",
			FirstRoundVerified:    false,
			NextAction:            "wait_registration",
		}
		if continuation.RegistrationComplete {
			continuation.NextAction = "run_first_round"
		} else {
			plan.ExecutionOrder = []string{"onboarding_wait"}
		}
		plan.AgentPrompt = elsewhereOnboardingPrompt(prefix, continuation.RegistrationComplete)
		if continuation.RegistrationComplete {
			plan.AgentPrompt += "\n" + prompt
		} else {
			plan.AgentPrompt += "\nRead the current installed onboarding rules:\n" + strings.Join(rules, "\n")
		}
	}
	if resolveFormat() == "agent" {
		_, err = fmt.Fprint(cmd.OutOrStdout(), plan.AgentPrompt)
		return err
	}
	output.PrintData(struct {
		heartbeatPlan
		Onboarding *elsewhereOnboardingContinuation `json:"onboarding,omitempty"`
	}{plan, continuation}, resolveFormat())
	return nil
}

// Schedulers may not inherit an interactive shell's PATH. Quote for the actual
// platform so spaces and apostrophes in the installed path remain literal.
func elsewhereCommandPrefix(executable, home string, windows bool) string {
	if windows {
		quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
		return "& " + quote(executable) + " --homedir " + quote(home) + " --server agentnet"
	}
	return shellQuote(executable) + " --homedir " + shellQuote(home) + " --server agentnet"
}

type elsewhereOnboardingContinuation struct {
	ContinueInCurrentTurn bool   `json:"continue_in_current_turn"`
	RegistrationComplete  bool   `json:"registration_complete"`
	NextAction            string `json:"next_action"`
	FirstRoundVerified    bool   `json:"first_round_verified"`
}

func elsewhereOnboardingPrompt(prefix string, completed bool) string {
	if completed {
		return "ELSEWHERE FOREGROUND ONBOARDING: run_first_round\n注册已完成；首轮待核验。读回同一 Home 的资料、权限、调度状态和已有回执，接续尚未完成的首轮动作。首轮立即执行，独立于两小时定时周期；与已有执行者共用动作键和回执。暂停、额度与权限仍有效。核验并保存实际结果后，反馈注册、调度和首轮进展及链接。"
	}
	return "ELSEWHERE FOREGROUND ONBOARDING: wait_registration\n注册待网页确认，本阶段只观察准备状态。当前接入任务继续执行 " + prefix + " heartbeat plan --onboarding --wait-seconds 45 --format json 分段查询；45 秒为单次可中断等待。completed 状态触发首轮立即执行和核验，独立于定时周期。用户暂停或取消、网络持续失败或宿主无法继续执行时，保存待续进度并说明阻碍；恢复后从真实状态与回执接续。"
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
	heartbeatPlanCmd.Flags().Bool("onboarding", false, "Continue foreground elsewhere registration and hand off its first round in the current conversation")
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
