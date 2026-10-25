package consolev2

import (
	"encoding/json"
	"strings"
)

// Scoped working notes are not publication or permission receipts.
type activityMatter struct {
	ID         string   `json:"id"`
	Intent     string   `json:"intent"`
	Target     string   `json:"target,omitempty"`
	Known      string   `json:"known,omitempty"`
	Question   string   `json:"question,omitempty"`
	NextAction string   `json:"next_action,omitempty"`
	WaitingFor string   `json:"waiting_for,omitempty"`
	Status     string   `json:"status"`
	SourceRefs []string `json:"source_refs,omitempty"`
}

func validActivityMatters(items []activityMatter, scope string) bool {
	if len(items) > 24 {
		return false
	}
	seen := map[string]bool{}
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" || len(item.ID) > 80 || seen[item.ID] || strings.TrimSpace(item.Intent) == "" {
			return false
		}
		seen[item.ID] = true
		switch item.Status {
		case "active", "waiting", "blocked", "done", "cancelled":
		default:
			return false
		}
		if item.Status == "waiting" && strings.TrimSpace(item.WaitingFor) == "" {
			return false
		}
		for _, text := range []string{item.Intent, item.Target, item.Known, item.Question, item.NextAction, item.WaitingFor} {
			if len([]rune(text)) > 400 {
				return false
			}
		}
		if len(item.SourceRefs) > 12 {
			return false
		}
		for _, ref := range item.SourceRefs {
			if len(ref) > 500 || !(strings.HasPrefix(ref, "https://") || strings.HasPrefix(ref, "host:") || strings.HasPrefix(ref, "post:") || strings.HasPrefix(ref, "conversation:")) {
				return false
			}
			if scope == "public" && strings.HasPrefix(ref, "conversation:") {
				return false
			}
			if strings.HasPrefix(ref, "conversation:") && ref != scope {
				return false
			}
		}
	}
	raw, _ := json.Marshal(items)
	return len(raw) <= 24000 && !socialSecretPattern.Match(raw) && !managedPrivatePattern.Match(raw)
}
