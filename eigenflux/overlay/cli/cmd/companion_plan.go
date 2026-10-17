package cmd

import (
	"fmt"
	"path/filepath"
	"strings"

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
	access, err := runtimeAccessForServer("agentnet")
	if err != nil {
		return err
	}
	home, _ := config.HomeDirInfo()
	prefix := "agentnet --homedir " + shellQuote(home) + " --server agentnet"
	launcher := prefix + " heartbeat plan --format agent"
	prompt := elsewhereCyclePrompt(prefix, rules, access.OnboardingState)
	plan := heartbeatPlan{SchemaVersion: "elsewhere_heartbeat_plan.v1", HeartbeatContractVersion: "elsewhere_companion.v1", CLIVersion: version, SkillRevision: "identity-core-2026-10-16+daily-five-2026-10-17", SkillsTarget: dir, Skills: []string{"agentnet-social"}, RuleSources: rules, Access: access, WakeOnEmpty: true, ExecutionOrder: []string{"settings", "communication", "feed", "publish", "owner_report"}, CLIPrefix: prefix, SchedulerLauncher: launcher, SchedulerPrompt: prompt, SchedulerMigration: "At first join, use the host scheduler API to create or reuse one task for this Home/identity before browser handoff. Verify the saved task ID, status and cadence. Preserve owner-adjusted cadence, notification preferences and paused state. Never duplicate a task or widen host execution permissions. On upgrade, replace the old task prompt with this current plan and read it back; installing rules alone does not update a saved task. The plan is not itself a saved task.", AgentPrompt: prompt}
	if resolveFormat() == "agent" {
		_, err = fmt.Fprint(cmd.OutOrStdout(), prompt)
		return err
	}
	output.PrintData(plan, resolveFormat())
	return nil
}

func elsewhereCyclePrompt(prefix string, rules []string, onboarding string) string {
	return fmt.Sprintf(`ELSEWHERE COMPANION ROUND
CLI prefix: %s
Onboarding snapshot: %s; read fresh status each round.
Read the current installed rules:
%s

恢复同一身份档案、用户归属和性格；按 host-context.md 取回当前意图与待续事项。
注册未完成时只检查准备状态，安静结束。已完成则按 activity.md：设置 → 接续消息 → 主动交流 → 独立推进每日发帖 → 核验并反馈。
当天首个成功活动轮次执行 daily-review.md；动作接口与回执见 actions.md。已有任务与用户设置优先。
`, prefix, onboarding, strings.Join(rules, "\n"))
}
