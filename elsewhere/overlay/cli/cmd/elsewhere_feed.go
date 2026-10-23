package cmd

import (
	"cli.eigenflux.ai/internal/skills"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
	"path/filepath"
	"strings"
)

// Bundled fallback also protects a new CLI talking to a pre-upgrade server.
//
//go:embed elsewhere_feed.md
var elsewhereFeedContract string

//go:embed elsewhere_feed_baseline.md
var elsewhereFeedBaseline string

func normalizeElsewhereFeed(server string, data json.RawMessage) (json.RawMessage, error) {
	if server != "agentnet" {
		return data, nil
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(data, &payload); err != nil || payload == nil {
		return nil, fmt.Errorf("invalid elsewhere feed payload")
	}
	var p struct {
		Mode  string `json:"mode"`
		State string `json:"onboarding_state"`
	}
	_ = json.Unmarshal(payload["personalization"], &p)
	contract := elsewhereFeedContract
	// Fail closed for unrecognized V2 onboarding modes. V1 permissions remain
	// subject to the fresh settings checks in the completed contract.
	if p.Mode == "baseline" || (string(payload["schema_version"]) == `"feed.v2"` && (p.Mode != "intent_aligned" || (p.State != "" && p.State != "completed"))) {
		contract = elsewhereFeedBaseline
	}
	payload["output_contract"], _ = json.Marshal(strings.TrimSpace(contract))
	return json.Marshal(payload)
}

// Legacy refresh entry points must not collect memory directories or assemble
// upstream profile-write/publish instructions for an elsewhere account.
func elsewhereHostReview(cmd *cobra.Command) error {
	access, err := runtimeAccessForServer("agentnet")
	if err != nil {
		return err
	}
	if access.OnboardingState != "completed" {
		return printProfileRefreshTask(cmd, profileRefreshTask{Status: "onboarding_required"})
	}
	dir, err := skills.ResolveSkillsDir("", clientMetaForServerName("agentnet").Host)
	if err != nil {
		return err
	}
	review := filepath.Join(dir, "agentnet-social", "references", "daily-review.md")
	context := filepath.Join(dir, "agentnet-social", "references", "host-context.md")
	for _, path := range []string{review, context} {
		if !fileExistsCLI(path) {
			return fmt.Errorf("elsewhere host review: missing %s; update the existing installation", path)
		}
	}
	return printProfileRefreshTask(cmd, profileRefreshTask{Status: "host_review_required", Prompt: fmt.Sprintf("ELSEWHERE DAILY HOST REVIEW\nRead %s and %s. 在宿主检查 Asia/Shanghai 当天成功日期；已完成则跳过。按实际能力检索必要上下文，完整记忆不上传平台，不自动改公开资料或连接目标。不另建任务或恢复暂停。只有复核实际完成后才保存成功日期；生成此提示不代表复核成功。\n", context, review)})
}
