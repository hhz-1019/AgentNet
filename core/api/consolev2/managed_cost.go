package consolev2

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"elsewhere_server/pkg/companionpolicy"
)

// Keep the same JSON object and instruction roles. Stable data comes before
// changing state so providers can reuse a prefix without caching model answers.
func managedMarshalInput(input any) ([]byte, error) {
	payload, ok := input.(map[string]any)
	if !ok {
		return json.Marshal(input)
	}
	view := make(map[string]any, len(payload))
	for key, value := range payload {
		view[key] = value
	}
	// An observation can be evidence, a completed action and a recent result.
	// Retain its full content once, with explicit references at the other sites.
	seen := map[string]string{}
	for _, key := range []string{"tool_results", "research", "evidence", "completed"} {
		items, ok := payload[key].([]map[string]any)
		if !ok || items == nil {
			continue
		}
		out := make([]map[string]any, len(items))
		for i, item := range items {
			raw, err := json.Marshal(item)
			if err != nil {
				return nil, err
			}
			if ref, exists := seen[string(raw)]; exists && len(raw) > 128 {
				out[i] = map[string]any{"tool": item["tool"], "observation_ref": ref}
			} else {
				out[i] = item
				seen[string(raw)] = fmt.Sprintf("%s[%d]", key, i)
			}
		}
		view[key] = out
	}
	priority := []string{"tools", "celebrity_profile", "persona", "name", "character_brief", "scenario", "agent_identity", "public_background", "original_samples", "background_documents", "date", "operator_topic", "required_action", "web_sources", "context", "continuation", "recent"}
	keys := make([]string, 0, len(view))
	used := map[string]bool{}
	for _, key := range priority {
		if _, exists := view[key]; exists {
			keys = append(keys, key)
			used[key] = true
		}
	}
	var tail []string
	for key := range view {
		if !used[key] {
			tail = append(tail, key)
		}
	}
	sort.Strings(tail)
	keys = append(keys, tail...)
	var out bytes.Buffer
	out.WriteByte('{')
	for i, key := range keys {
		value, err := json.Marshal(view[key])
		if err != nil {
			return nil, err
		}
		if i > 0 {
			out.WriteByte(',')
		}
		name, _ := json.Marshal(key)
		out.Write(name)
		out.WriteByte(':')
		out.Write(value)
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}

// Input fitting and sending must count exactly the same policy and wire data.
func managedEffectivePrompt(input any, prompt string) string {
	if !strings.Contains(prompt, companionpolicy.Identity) {
		prompt = companionpolicy.Identity + prompt
	}
	if payload, ok := input.(map[string]any); ok {
		for _, key := range []string{"tool_results", "research", "evidence", "completed"} {
			if _, exists := payload[key]; exists {
				prompt += "\nobservation_ref 指向本次输入中同一份完整工具回执（例如 evidence[0]）；引用不代表缺少证据，不要重复读取或执行。\n"
				break
			}
		}
	}
	if payload, ok := input.(map[string]any); ok && payload["celebrity_profile"] != nil {
		prompt += celebrityWritingPrompt + celebrityIdentityPrompt
	}
	return prompt
}
