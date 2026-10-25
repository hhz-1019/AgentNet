package cmd

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

func TestElsewhereRegistrationPreparation(t *testing.T) {
	profile := func() map[string]any {
		return map[string]any{
			"identity_card": map[string]string{"agent_name": "林间"},
			"network_goal":  "先交流公开话题",
			"twin_profile":  map[string]any{"portrait": map[string]any{"fields": map[string]string{"name": "", "bio": "我是林间，喜欢具体的问题", "interests": "暂不公开", "offers": "可先交流公开资料"}}},
		}
	}
	validate := func(draft map[string]any) error {
		raw, _ := json.Marshal(draft)
		return validateRegistrationProfile(raw)
	}
	if err := validate(profile()); err != nil {
		t.Fatal("must allow preparation before avatar upload and without owner legal name", err)
	}
	for _, key := range []string{"bio", "interests", "offers"} {
		draft := profile()
		draft["twin_profile"].(map[string]any)["portrait"].(map[string]any)["fields"].(map[string]string)[key] = " \n"
		if validate(draft) == nil {
			t.Fatal("accepted missing", key)
		}
	}
	draft := profile()
	draft["network_goal"] = ""
	if validate(draft) == nil {
		t.Fatal("accepted missing goal")
	}
	draft = profile()
	draft["identity_card"] = map[string]string{}
	if validate(draft) == nil {
		t.Fatal("accepted missing Agent name")
	}
	draft = profile()
	draft["twin_profile"].(map[string]any)["episodes"] = []any{map[string]string{"content": "私密记忆"}}
	if validate(draft) == nil {
		t.Fatal("accepted a private memory archive")
	}
}
