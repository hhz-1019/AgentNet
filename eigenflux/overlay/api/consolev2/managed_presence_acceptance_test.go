package consolev2

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// Paid A/B comparison is separate from fixture regression. It calls only the
// provider: no Service, database writes, public posts, or messages are involved.
func TestManagedPresenceRealProviderComparison(t *testing.T) {
	if os.Getenv("AGENTNET_MANAGED_PRESENCE_ACCEPTANCE") != "true" {
		t.Skip("real provider comparison is opt-in")
	}
	if !managedModelConfigured() {
		t.Fatal("configure the platform model privately before paid comparison")
	}
	count := 5
	if value := os.Getenv("AGENTNET_MANAGED_PRESENCE_SAMPLES"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > 15 {
			t.Fatal("sample count must be 1..15")
		}
		count = n
	}
	report := os.Getenv("AGENTNET_MANAGED_PRESENCE_REPORT")
	if report == "" {
		t.Fatal("set an absolute private report path before running paid comparison")
	}
	if !filepath.IsAbs(report) {
		t.Fatal("report path must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(report), 0700); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(report, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	encoder := json.NewEncoder(f)
	topics := []string{
		"讨论这个假设的公开活动说明：允许只旁听，但每位参加者都须提前提交一个问题。只谈你在意的一点，不把活动写成真实参加经历。",
		"讨论这个假设的作品展示规则：只能放一页，允许保留未完成部分。不预先指定该保留什么，只谈自己在意的一点。",
		"讨论这个假设的学习材料：读完定义能复述，但换一个条件就不知道如何使用。只谈自己在意的一点，没有实际学习经历可供引用。",
	}
	for i, seed := range managedPresenceSeeds[:count] {
		role := managedCatalog()[seed]
		job := managedJob{AgentID: int64(1000 + seed), RunID: 1, SeedIndex: &seed, Name: role.Name, Scenario: role.Scenario, Persona: role.Persona, Action: "post", Topic: topics[i/5]}
		for _, variant := range []string{"A_current_local", "B_presence_pilot"} {
			payload := map[string]any{"name": job.Name, "persona": job.Persona, "scenario": job.Scenario, "character_brief": job.characterBrief(), "operator_topic": job.Topic, "required_action": "post", "angle_hint": managedAngle(job), "writing_brief": managedWritingBrief(job.AgentID, job.RunID), "perspective_brief": managedPerspective(job, 0), "context": managedContext{}}
			if variant == "B_presence_pilot" {
				managedApplyPresence(payload, job)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			result, callErr := callManagedModel(ctx, payload)
			cancel()
			originalDraft := result.Value
			summaryRepaired := false
			validation := ""
			if callErr == nil && result.Value.Action == "post" {
				summaryRepaired = managedRepairSummary(&result.Value)
				validation = managedWritingIssue(result.Value)
				d := result.Value.Document
				d.Identity = "agent"
				if e := validateSocialDocument(&d, "public"); e != nil {
					validation = "document_schema"
				}
			} else if callErr == nil && result.Value.Action != "skip" {
				validation = "task_action"
			}
			receipt := map[string]any{"variant": variant, "seed_index": seed, "name": role.Name, "topic": job.Topic, "input_tokens": result.Input, "output_tokens": result.Output, "usage_known": result.UsageKnown, "summary_repaired": summaryRepaired, "validation": validation, "original_draft": originalDraft, "draft": result.Value, "published": false, "human_quality_review": "pending"}
			if callErr != nil {
				receipt["failure"] = managedFailureCode(callErr)
			}
			if err := encoder.Encode(receipt); err != nil {
				t.Fatal(err)
			}
			if err := f.Sync(); err != nil {
				t.Fatal(err)
			}
			if callErr != nil || !result.UsageKnown || validation != "" {
				t.Fatalf("comparison stopped; inspect private receipt for seed %d variant %s", seed, variant)
			}
		}
	}
	t.Logf("Saved %d non-publishing draft pairs. Naturalness, identity and semantic diversity still require blind human review.", count)
}
