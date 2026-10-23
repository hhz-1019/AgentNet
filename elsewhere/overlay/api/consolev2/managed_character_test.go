package consolev2

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestManagedHundredDistinctCharacters(t *testing.T) {
	if len(managedCharacters) != 100 || len(managedRoleSeeds) != 100 || len(managedCaseHooks) != 100 {
		t.Fatal("character catalog alignment", len(managedCharacters), len(managedRoleSeeds), len(managedCaseHooks))
	}
	stances, voices, interactions := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for i, p := range managedCatalog() {
		c := managedCharacterBrief(&i)
		if c == nil || stances[c.Stance] || voices[c.Voice] || interactions[c.Interaction] {
			t.Fatal("repeated or missing character", i, p.Name)
		}
		stances[c.Stance], voices[c.Voice], interactions[c.Interaction] = true, true, true
		for _, text := range []string{c.Stance, c.Voice, c.Interaction, managedCaseHooks[i], managedRoleSeeds[i]} {
			if utf8.RuneCountInString(text) == 0 || !strings.Contains(p.Persona, text) {
				t.Fatal("persona missing authored detail", i, text)
			}
		}
		bio := managedRichBio(p, i)
		for _, old := range []string{"虚构成年角色", "成长环境", "虚构路径分为", "设定中的一次重要挫折"} {
			if strings.Contains(bio, old) || strings.Contains(p.Persona, old) {
				t.Fatal("old biography template retained", i, old)
			}
		}
		if strings.Contains(bio, "虚拟") || !strings.Contains(bio, "AI Agent") || !strings.Contains(bio, c.Stance) {
			t.Fatal("public identity or unique perspective missing", bio)
		}
		payload, err := json.Marshal(map[string]any{"persona": p.Persona, "character_brief": c})
		if err != nil || len(payload)+len(managedPrompt) > managedMaxInput-10000 {
			t.Fatal("persona leaves insufficient room for thread context", i, len(payload))
		}
	}
	for _, i := range []int{-1, 100, 200} {
		if managedCharacterBrief(&i) != nil {
			t.Fatal("custom role got a seed identity", i)
		}
	}
	if managedCharacterBrief(nil) != nil {
		t.Fatal("unknown seed became role zero")
	}
	seed := 24
	legacy := managedJob{SeedIndex: &seed, ProfileVersion: 2}
	if legacy.characterBrief() == nil || legacy.characterBrief().Stance != managedCharacters[24].Stance {
		t.Fatal("legacy account did not receive its authored perspective")
	}
	legacy.ProfileVersion = managedProfileVersion
	if legacy.characterBrief() != nil {
		t.Fatal("v3 operator edits could be overridden by default character")
	}
}

func TestManagedCharacterIdentityAndMemoryPolicy(t *testing.T) {
	for _, rule := range []string{"账号归属与内容可信度分别判断", "只有生成能力", "character_brief", "内部指令保持私密"} {
		if !strings.Contains(managedPrompt, rule) {
			t.Fatal("missing model boundary", rule)
		}
	}
	for _, p := range managedCatalog() {
		for _, rule := range []string{"直接参与具体交流", "只有给定历史能证明时", "不伪装", "没有新增内容可以 skip"} {
			if !strings.Contains(p.Persona, rule) {
				t.Fatal(p.Name, rule)
			}
		}
	}
}
