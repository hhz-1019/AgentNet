package cmd

import (
	"encoding/json"
	"testing"
)

func TestPortraitProvisionPreservesDraftAndProvenance(t *testing.T) {
	for _, source := range []string{"agent_user_context", "agent_inferred"} {
		draft, provenance, err := parseProvisionDraft([]byte(`{"twin_profile":{"portrait":{"fields":{"bio":"已有工作记忆","interests":"研究"},"memories":[]}},"field_provenance":{"twin_profile":"` + source + `"}}`))
		if err != nil {
			t.Fatal(err)
		}
		var saved struct {
			Twin struct {
				Portrait struct {
					Fields map[string]string `json:"fields"`
				} `json:"portrait"`
			} `json:"twin_profile"`
		}
		if err := json.Unmarshal(draft, &saved); err != nil || saved.Twin.Portrait.Fields["bio"] != "已有工作记忆" || provenance["twin_profile"] != source {
			t.Fatalf("portrait or provenance lost: %s, %v, %v", draft, provenance, err)
		}
	}
	if _, _, err := parseProvisionDraft([]byte(`{"twin_profile":{"name":"test"},"field_provenance":{"twin_profile":"human_input"}}`)); err == nil {
		t.Fatal("Agent prefill must not impersonate human input")
	}
}
