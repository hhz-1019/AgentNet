package consolev2

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func richTestDraft() map[string]any {
	list := func(n int) string {
		items := []string{}
		for i := 0; i < n; i++ {
			items = append(items, fmt.Sprintf("%d. 方向%d：%s", i+1, i, strings.Repeat("具体", 100)))
		}
		return strings.Join(items, "\n\n")
	}
	memories := []map[string]any{}
	for i := 0; i < 20; i++ {
		memories = append(memories, map[string]any{"id": fmt.Sprintf("00000000-0000-4000-8000-%012d", i), "content": fmt.Sprintf("事件%d", i) + strings.Repeat("经历", 150)})
	}
	return map[string]any{"twin_profile": map[string]any{"portrait": map[string]any{"prefill_version": richPortraitVersion, "fields": map[string]string{"bio": strings.Repeat("理解", 250), "interests": list(10), "recent": list(3), "connections": list(5)}, "memories": memories}}}
}
func TestElsewhereRichPortraitCompleteness(t *testing.T) {
	d := richTestDraft()
	raw, _ := json.Marshal(d)
	if e := validateRichPortrait(raw); e != nil {
		t.Fatal(e)
	}
	p := d["twin_profile"].(map[string]any)["portrait"].(map[string]any)
	f := p["fields"].(map[string]string)
	f["bio"] = "由你在注册页面补充"
	f["interests"] = strings.Repeat("a", 199) + "\n\n" + strings.Repeat("a", 199)
	p["memories"] = []any{}
	raw, _ = json.Marshal(d)
	e := validateRichPortrait(raw)
	if e == nil || !strings.Contains(e.Error(), "简介") || !strings.Contains(e.Error(), "兴趣") || !strings.Contains(e.Error(), "记忆") {
		t.Fatal("must report all gaps", e)
	}
	if portraitCharacterCount("中 文\n😀") != 3 {
		t.Fatal("count Unicode characters, not bytes or spaces")
	}
	d = richTestDraft()
	p = d["twin_profile"].(map[string]any)["portrait"].(map[string]any)
	f = p["fields"].(map[string]string)
	f["interests"] = strings.Repeat(strings.Repeat("相同", 100)+"\n\n", 10)
	raw, _ = json.Marshal(d)
	if validateRichPortrait(raw) == nil {
		t.Fatal("repeated content cannot count as independent items")
	}
	d = richTestDraft()
	p = d["twin_profile"].(map[string]any)["portrait"].(map[string]any)
	f = p["fields"].(map[string]string)
	f["bio"] = strings.Repeat("更多细节", 6000)
	mem := p["memories"].([]map[string]any)
	for i := 20; i < 120; i++ {
		mem = append(mem, map[string]any{"content": fmt.Sprintf("事件%d", i) + strings.Repeat("细节", 9000)})
	}
	p["memories"] = mem
	raw, _ = json.Marshal(d)
	if e := validateRichPortrait(raw); e != nil {
		t.Fatal("no prose or count maximum", e)
	}
}

func TestElsewhereRichDraftNormalizationPreservesLongPortrait(t *testing.T) {
	d := richTestDraft()
	p := d["twin_profile"].(map[string]any)["portrait"].(map[string]any)
	fields := p["fields"].(map[string]string)
	fields["bio"] = strings.Repeat("完整简介", 10000)
	raw, _ := json.Marshal(d)
	normalized, _, err := normalizeOnboardingDraftJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	var payload draftPayload
	if err = json.Unmarshal(normalized, &payload); err != nil {
		t.Fatal(err)
	}
	if err = validateDraftPayload(payload); err != nil {
		t.Fatal(err)
	}
	if payload.TwinProfile.Portrait.Fields["bio"] != fields["bio"] || len(payload.TwinProfile.Portrait.Memories) != 20 {
		t.Fatal("normalization lost rich profile contents")
	}
}
