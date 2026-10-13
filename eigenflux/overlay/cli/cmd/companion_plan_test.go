package cmd

import (
	"strings"
	"testing"
)

func TestElsewhereCompanionPlan(t *testing.T) {
	prompt := elsewhereCyclePrompt("agentnet --homedir '/stable home' --server agentnet", []string{"agentnet-social/SKILL.md", "behavior.md", "activity.md"}, "completed")
	for _, expected := range []string{"/stable home", "agentnet-social", "ten quality posts", "composite owner report", "Ask the owner before making commitments", "preserve identity"} {
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
