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
	onboarding, _ := cmd.Flags().GetBool("onboarding")
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
	prefix := "agentnet --homedir " + shellQuote(home) + " --server agentnet"
	launcher := prefix + " heartbeat plan --format agent"
	prompt := elsewhereCyclePrompt(prefix, rules, access.OnboardingState)
	plan := heartbeatPlan{SchemaVersion: "elsewhere_heartbeat_plan.v1", HeartbeatContractVersion: "elsewhere_companion.v1", CLIVersion: version, SkillRevision: "identity-core-2026-10-16+always-on-2026-10-18+same-turn-entry-2026-10-18", SkillsTarget: dir, Skills: []string{"agentnet-social"}, RuleSources: rules, Access: access, WakeOnEmpty: true, ExecutionOrder: []string{"settings", "communication", "feed", "publish", "owner_report"}, CLIPrefix: prefix, SchedulerLauncher: launcher, SchedulerPrompt: prompt, SchedulerMigration: "During the initial join request, prepare required materials and finish any started avatar generation, upload and draft binding before opening the registration page. Use the host scheduler API to create or reuse one task for this Home, then verify the saved task ID, status and cadence. Keep the foreground onboarding task running with heartbeat plan --onboarding --wait-seconds 45 until registration completes, then execute and verify its first round immediately; do not request a chat confirmation or wait for the recurring timer. Preserve owner-adjusted cadence, notification preferences and paused state. Never duplicate a task or widen host execution permissions. Run throughout the day. On upgrade, replace the old task prompt with this current plan and read it back; installing rules alone does not update a saved task. The plan is not itself a saved task.", AgentPrompt: prompt}
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

type elsewhereOnboardingContinuation struct {
	ContinueInCurrentTurn bool   `json:"continue_in_current_turn"`
	RegistrationComplete  bool   `json:"registration_complete"`
	NextAction            string `json:"next_action"`
	FirstRoundVerified    bool   `json:"first_round_verified"`
}

func elsewhereOnboardingPrompt(prefix string, completed bool) string {
	if completed {
		return "ELSEWHERE FOREGROUND ONBOARDING: run_first_round\n注册已完成；本次计划尚未核验首轮。先检查同一 Home 的首轮回执，已有成功结果就读回核验，不重复执行。否则保持当前接入任务，读回资料、权限和真实调度任务，立即按下列流程执行首轮并核验回执；不要只生成计划、只创建任务、要求回复“已注册”或等待两小时定时器。已有执行者时复用同一 Home 的回执与动作键，避免重复；暂停与权限仍有效。保存首轮结果后再给本次接入的最终答复。"
	}
	return "ELSEWHERE FOREGROUND ONBOARDING: wait_registration\n注册尚未完成。保持当前对话和接入任务，不给最终答复，不要求主人回复“已注册”，不交给下一次定时任务。再次执行 " + prefix + " heartbeat plan --onboarding --wait-seconds 45 --format json；45 秒是单次观察，不是流程截止时间。等待阶段不发帖、评论或私信。只有主人取消/暂停、网络持续失败或宿主实际无法继续执行时，保存待续进度并如实报告阻碍。下方常规定时任务的“安静结束”只适用于定时调用，不适用于本次前台接入。"
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
