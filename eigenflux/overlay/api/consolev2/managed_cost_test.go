package consolev2

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestManagedCostStablePrefixPreservesFields(t *testing.T) {
	payload := map[string]any{
		"tools":           strings.Repeat("工具说明", 400),
		"persona":         strings.Repeat("人物性格与事实边界", 300),
		"context":         map[string]any{"source": "https://example.com/fact", "text": "完整来源"},
		"activity_plan":   map[string]any{"remaining": 3},
		"steps_remaining": 16,
	}
	before, _ := json.Marshal(payload)
	first, err := managedMarshalInput(payload)
	if err != nil {
		t.Fatal(err)
	}
	var old, current any
	_ = json.Unmarshal(before, &old)
	_ = json.Unmarshal(first, &current)
	if !reflect.DeepEqual(old, current) {
		t.Fatal("fields or values changed")
	}
	payload["activity_plan"] = map[string]any{"remaining": 2}
	payload["steps_remaining"] = 15
	second, _ := managedMarshalInput(payload)
	legacySecond, _ := json.Marshal(payload)
	common := func(a, b []byte) int {
		n := 0
		for n < len(a) && n < len(b) && a[n] == b[n] {
			n++
		}
		return n
	}
	legacyPrefix, prefix := common(before, legacySecond), common(first, second)
	if prefix < len(first)*9/10 {
		t.Fatalf("stable information lost from prefix: %d/%d", prefix, len(first))
	}
	t.Logf("same complete fields: old shared prefix=%d bytes, new=%d bytes, total=%d bytes", legacyPrefix, prefix, len(first))
}

func TestManagedCostObservationDedupIsLossless(t *testing.T) {
	observation := map[string]any{"tool": "read", "arguments": map[string]any{"url": "https://example.com/source"}, "result": activityJSON(200, map[string]any{"data": map[string]any{"text": strings.Repeat("有出处的完整原文。", 600), "receipt_id": "verified-1"}})}
	payload := map[string]any{"evidence": []map[string]any{observation}, "tool_results": []map[string]any{observation}, "research": []map[string]any{observation}}
	before, _ := json.Marshal(payload)
	wire, err := managedMarshalInput(payload)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(payload)
	if !bytes.Equal(before, after) {
		t.Fatal("source context mutated")
	}
	var decoded map[string][]map[string]any
	if err = json.Unmarshal(wire, &decoded); err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(observation)
	var expected map[string]any
	_ = json.Unmarshal(want, &expected)
	if !reflect.DeepEqual(decoded["tool_results"][0], expected) {
		t.Fatal("evidence lost")
	}
	for _, key := range []string{"evidence", "research"} {
		if decoded[key][0]["observation_ref"] != "tool_results[0]" {
			t.Fatal("unresolvable reference", key)
		}
	}
	if len(wire)*2 > len(before) {
		t.Fatal("duplicate evidence not removed")
	}
	t.Logf("full evidence preserved: %d -> %d bytes (%.1f%% smaller)", len(before), len(wire), 100*(1-float64(len(wire))/float64(len(before))))
	// Different responses from the same URL must never share an observation.
	payload["research"] = []map[string]any{{"tool": "read", "result": "changed evidence"}}
	wire, _ = managedMarshalInput(payload)
	if !bytes.Contains(wire, []byte("changed evidence")) {
		t.Fatal("distinct evidence discarded")
	}
}

func TestManagedCostFitMatchesWire(t *testing.T) {
	for _, celebrity := range []bool{false, true} {
		payload := map[string]any{"activity_mode": true, "tools": strings.Repeat("schema", 300)}
		if celebrity {
			payload["celebrity_profile"] = celebrityCatalog()[0]
		}
		c := managedContext{}
		payload["context"] = c
		base, _ := managedMarshalInput(payload)
		prompt := managedEffectivePrompt(payload, managedActivityPrompt())
		// Fit at the real transport boundary, including the reference instructions.
		payload["padding"] = strings.Repeat("x", managedMaxInput-1000-len(base)-len(prompt)-13)
		if !managedFitInput(payload, &c) {
			t.Fatal("valid boundary rejected", celebrity)
		}
		wire, _ := managedMarshalInput(payload)
		if len(wire)+len(prompt) > managedMaxInput-1000 {
			t.Fatal("fit approved oversized request")
		}
		payload["padding"] = payload["padding"].(string) + strings.Repeat("x", 20)
		if managedFitInput(payload, &c) {
			t.Fatal("oversized request approved")
		}
	}
}
