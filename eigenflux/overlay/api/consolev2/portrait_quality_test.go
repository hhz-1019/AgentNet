package consolev2

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestElsewhereHostProfileContract(t *testing.T) {
	validate := func(v any) error { raw, _ := json.Marshal(v); return validateRichPortrait(raw) }
	minimal := func() map[string]any {
		return map[string]any{"portrait": map[string]any{"prefill_version": richPortraitVersion, "fields": map[string]string{"bio": "我叫小满，喜欢接着具体的问题聊。", "interests": "画画", "offers": ""}}}
	}
	for _, twin := range []any{minimal(), map[string]any{}, map[string]any{"portrait": map[string]any{"fields": map[string]string{}}}} {
		if e := validate(map[string]any{"twin_profile": twin}); e != nil {
			t.Fatal("current-conversation-only must work", e)
		}
	}
	for _, key := range []string{"episodes", "knowledge", "relationships"} {
		p := minimal()
		p[key] = []any{map[string]string{"content": "私密经历"}}
		if validate(map[string]any{"twin_profile": p}) == nil {
			t.Fatal("accepted", key)
		}
	}
	for _, key := range []string{"memories"} {
		p := minimal()
		p["portrait"].(map[string]any)[key] = []any{map[string]string{"content": "私密经历"}}
		if validate(map[string]any{"twin_profile": p}) == nil {
			t.Fatal("accepted", key)
		}
	}
	p := minimal()
	p["portrait"].(map[string]any)["prefill_version"] = "portrait-rich-2026-10-14"
	if validate(map[string]any{"twin_profile": p}) == nil {
		t.Fatal("old instruction accepted")
	}
	p = minimal()
	p["portrait"].(map[string]any)["fields"].(map[string]string)["bio"] = strings.Repeat("忆", 601)
	if validate(map[string]any{"twin_profile": p}) == nil {
		t.Fatal("memory archive disguised as biography")
	}
	p = minimal()
	p["portrait"].(map[string]any)["fields"].(map[string]string)["recent"] = "private event"
	if validate(map[string]any{"twin_profile": p}) == nil {
		t.Fatal("legacy field accepted")
	}
	p = minimal()
	p["persona"] = map[string]any{"traits": map[string]any{"openness": 0.9}}
	if validate(map[string]any{"twin_profile": p}) == nil {
		t.Fatal("private persona accepted")
	}
}

func TestElsewhereLoadedDraftExcludesArchivedMemory(t *testing.T) {
	raw := json.RawMessage(`{"network_goal":"找读书同伴","twin_profile":{"basic_info":{"role":"私密身份"},"episodes":[{"content":"私密经历"}],"portrait":{"prefill_version":"portrait-rich-2026-10-14","fields":{"bio":"可确认简介","recent":"私密事件","offers":"可分享的书单"},"memories":[{"content":"私密记录"}]}}}`)
	original := string(raw)
	normalized, err := normalizeLoadedOnboardingDraft(onboardingDraft{DraftData: raw})
	if err != nil {
		t.Fatal(err)
	}
	text := string(normalized.DraftData)
	for _, secret := range []string{"私密身份", "私密经历", "私密事件", "私密记录", "portrait-rich-2026-10-14"} {
		if strings.Contains(text, secret) {
			t.Fatal("archive leaked through registration", secret)
		}
	}
	if !strings.Contains(text, "可分享的书单") || !strings.Contains(text, "找读书同伴") {
		t.Fatal("minimal data lost", text)
	}
	if string(raw) != original {
		t.Fatal("stored input mutated")
	}
	if err := validateRichPortrait(normalized.DraftData); err != nil {
		t.Fatal("old registration cannot resume", err)
	}
}
