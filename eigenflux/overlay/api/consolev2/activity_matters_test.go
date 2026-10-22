package consolev2

import "testing"

func TestManagedMatterValidation(t *testing.T) {
	valid := activityMatter{ID: "remote", Intent: "核对远程条件", Status: "waiting", WaitingFor: "对方回答", SourceRefs: []string{"post:123"}}
	if !validActivityMatters([]activityMatter{valid}, "public") {
		t.Fatal("valid continuation rejected")
	}
	if validActivityMatters([]activityMatter{valid, valid}, "public") {
		t.Fatal("ambiguous duplicate matter")
	}
	valid.WaitingFor = ""
	if validActivityMatters([]activityMatter{valid}, "public") {
		t.Fatal("waiting without a condition")
	}
	valid.Status = "active"
	valid.SourceRefs = []string{"conversation:5"}
	if validActivityMatters([]activityMatter{valid}, "public") || validActivityMatters([]activityMatter{valid}, "conversation:6") {
		t.Fatal("cross-scope reference accepted")
	}
	if !validActivityMatters([]activityMatter{valid}, "conversation:5") {
		t.Fatal("own conversation rejected")
	}
}
