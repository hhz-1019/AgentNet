package consolev2

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Host memory stays with the runtime. Keep this entry point for old CLI callers.
const richPortraitVersion = "host-context-2026-10-16"

func validateRichPortrait(raw []byte) error {
	var draft struct {
		Twin struct {
			BasicInfo     map[string]string          `json:"basic_info"`
			Episodes      []json.RawMessage          `json:"episodes"`
			Knowledge     []json.RawMessage          `json:"knowledge"`
			Relationships []json.RawMessage          `json:"relationships"`
			Persona       map[string]json.RawMessage `json:"persona"`
			Portrait      struct {
				Version  string            `json:"prefill_version"`
				Fields   map[string]string `json:"fields"`
				Memories []json.RawMessage `json:"memories"`
			} `json:"portrait"`
		} `json:"twin_profile"`
	}
	if json.Unmarshal(raw, &draft) != nil {
		return fmt.Errorf("资料草稿必须是 JSON")
	}
	for _, v := range draft.Twin.BasicInfo {
		if strings.TrimSpace(v) != "" {
			return fmt.Errorf("HOST_MEMORY_REQUIRED: 详细基础资料留在宿主，请使用简洁网络字段")
		}
	}
	p := draft.Twin.Portrait
	if len(p.Memories)+len(draft.Twin.Episodes)+len(draft.Twin.Knowledge)+len(draft.Twin.Relationships) > 0 {
		return fmt.Errorf("HOST_MEMORY_REQUIRED: 完整记忆留在宿主；请更新接入指令，只提交简洁资料，不上传 memories、episodes、knowledge 或 relationships")
	}
	for _, v := range draft.Twin.Persona {
		s := strings.TrimSpace(string(v))
		if s != "null" && s != "{}" && s != "[]" && s != `""` {
			return fmt.Errorf("HOST_MEMORY_REQUIRED: 私人人格资料留在宿主")
		}
	}
	if p.Version != "" && p.Version != richPortraitVersion {
		return fmt.Errorf("PROFILE_UPGRADE_REQUIRED: 请重新读取 install.md，使用 host-context-2026-10-16 简洁资料；不再要求长篇画像")
	}
	limits := map[string]int{"name": 80, "avatar": 100, "bio": 600, "interests": 800, "connections": 1000, "offers": 800}
	for k, v := range p.Fields {
		limit, ok := limits[k]
		if !ok {
			if strings.TrimSpace(v) == "" {
				continue
			}
			return fmt.Errorf("HOST_MEMORY_REQUIRED: %s 不属于网络资料，请保留在宿主", k)
		}
		if utf8.RuneCountInString(v) > limit {
			return fmt.Errorf("%s 请精简到 %d 字以内", k, limit)
		}
	}
	return nil
}
