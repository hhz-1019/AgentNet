package consolev2

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
)

type ActivityManagedJob managedJob

type activityReviewState struct {
	Revision  int64           `json:"revision"`
	Day       string          `json:"day"`
	Intent    string          `json:"intent"`
	Summary   string          `json:"summary"`
	Evidence  json.RawMessage `json:"evidence"`
	UpdatedAt int64           `json:"updated_at"`
}

// Source adapters provide data, never a separate set of behavioral instructions.
// Full private memory stays with the host. Only the current purpose and public
// evidence references are kept here for continuity and operational visibility.
func (s *Service) activityProfile(ctx context.Context, id int64, settings companionSettings, progress publishingProgress) (map[string]any, error) {
	db := s.db.WithContext(ctx)
	var review activityReviewState
	if err := db.Raw("SELECT revision,day::text,intent,summary,evidence,updated_at FROM agent_activity_reviews WHERE agent_id=?", id).Scan(&review).Error; err != nil {
		return nil, err
	}
	profile := map[string]any{"agent_id": fmtRun(id), "agent_name": settings.AgentName, "owner_name": settings.OwnerName, "owner_kind": "user", "context_source": "host_memory", "executor": "external_host", "intent": settings.ConnectionGoal, "review": review, "review_due": review.Day != progress.Day}
	var managed struct {
		ActivityManagedJob
		Enabled    bool
		DailyLimit int
		Attempts   int
		NextRunAt  int64
		StartHour  int
		EndHour    int
	}
	if err := db.Raw(`SELECT m.agent_id,m.seed_index,m.name,m.scenario,m.persona,m.persona_edited,m.profile_version,m.sponsor_uid,m.enabled AND c.enabled AND m.deleted_at=0 AS enabled,m.daily_limit,m.start_hour,m.end_hour,m.next_run_at,(SELECT count(*) FROM managed_runs r WHERE r.agent_id=m.agent_id AND r.day=?::date) AS attempts FROM managed_members m JOIN managed_campaigns c USING(sponsor_uid) WHERE m.agent_id=?`, progress.Day, id).Scan(&managed).Error; err != nil {
		return nil, err
	}
	if managed.AgentID != 0 {
		profile["owner_kind"] = "platform_operator"
		profile["owner_name"] = "本账号运营者"
		profile["executor"] = "platform_host"
		profile["context_source"] = "public_search"
		profile["character"] = activityCharacter(managedJob(managed.ActivityManagedJob))
		profile["intent"] = managedJob(managed.ActivityManagedJob).identitySnapshot()["intent"]
		profile["runtime_status"] = map[string]any{"enabled": managed.Enabled, "start_hour": managed.StartHour, "end_hour": managed.EndHour, "attempt_limit": managed.DailyLimit, "attempts": managed.Attempts, "next_run_at": managed.NextRunAt, "attempt_budget_exhausted": managed.Attempts >= managed.DailyLimit}
		if p := celebrityForJob(managedJob(managed.ActivityManagedJob)); p != nil {
			profile["represented_subject"] = p.Name
			profile["source_hints"] = append([]string{p.Reference}, p.OfficialSites...)
			profile["representation"] = "public_information_agent"
			profile["intent"] = "关注" + p.Name + "的" + p.Focus + "，依据公开原文回应具体问题并跟进新进展"
		} else if managed.SeedIndex != nil && *managed.SeedIndex >= 30000 && *managed.SeedIndex < 30000+len(recruitmentBoards) {
			p := recruitmentBoards[*managed.SeedIndex-30000]
			profile["represented_subject"] = p.Company
			profile["source_hints"] = []string{p.URL, p.Endpoint}
			profile["representation"] = "public_information_agent"
			profile["intent"] = "整理" + p.Company + "官方岗位与公开业务资料，接住求职者的具体条件和问题，核实并持续跟进"
		} else if managed.SeedIndex != nil && *managed.SeedIndex >= 10000 && *managed.SeedIndex <= 10004 {
			// Historical catalog imports retain their IDs and operating switches.
			// Their original official sources become data in the same adapter.
			subject := strings.TrimSuffix(managed.Name, " · 招聘信息")
			profile["represented_subject"] = subject
			profile["representation"] = "public_information_agent"
			hints := []string{}
			for _, ref := range regexp.MustCompile(`https://[^\s<>"，。；]+`).FindAllString(managed.Persona, 20) {
				if activityPublicURL(ref) {
					hints = append(hints, ref)
				}
			}
			profile["source_hints"] = hints
			profile["intent"] = "核对" + subject + "的公开岗位及当前申请条件，回应真实问题并跟进变化"
		} else {
			profile["representation"] = "operator_agent"
		}
	}
	if review.Intent != "" {
		profile["intent"] = review.Intent
	}
	return profile, nil
}

func (s *Service) activityReview(ctx context.Context, c *app.RequestContext, req activityRequest) {
	id, _ := agentID(c)
	var v struct {
		Revision int64    `json:"revision"`
		Intent   string   `json:"intent"`
		Summary  string   `json:"summary"`
		Evidence []string `json:"evidence"`
	}
	if json.Unmarshal(req.Data, &v) != nil || strings.TrimSpace(v.Intent) == "" || strings.TrimSpace(v.Summary) == "" || len([]rune(v.Intent)) > 1000 || len([]rune(v.Summary)) > 1500 || len(v.Evidence) > 20 || socialSecretPattern.Match(req.Data) || managedPrivatePattern.Match(req.Data) {
		fail(c, 400, "ACTIVITY_REVIEW", "复核需有具体目的和依据，保持简短", nil)
		return
	}
	for _, ref := range v.Evidence {
		if len(ref) > 2000 || !(activityPublicURL(ref) || strings.HasPrefix(ref, "post:") || strings.HasPrefix(ref, "comment:") || strings.HasPrefix(ref, "host:")) {
			fail(c, 400, "ACTIVITY_REVIEW", "仅保存来源引用", nil)
			return
		}
	}
	evidence, _ := json.Marshal(v.Evidence)
	now := time.Now()
	day := now.In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01-02")
	r := s.db.WithContext(ctx).Exec(`INSERT INTO agent_activity_reviews(agent_id,revision,day,intent,summary,evidence,updated_at) SELECT ?,1,?::date,?,?,?::jsonb,? WHERE ?=0 ON CONFLICT DO NOTHING`, id, day, v.Intent, v.Summary, string(evidence), now.UnixMilli(), v.Revision)
	if v.Revision > 0 {
		r = s.db.WithContext(ctx).Exec(`UPDATE agent_activity_reviews SET revision=revision+1,day=?::date,intent=?,summary=?,evidence=?::jsonb,updated_at=? WHERE agent_id=? AND revision=?`, day, v.Intent, v.Summary, string(evidence), now.UnixMilli(), id, v.Revision)
	}
	if r.Error != nil {
		s.socialFailure(c, r.Error)
		return
	}
	if r.RowsAffected != 1 {
		fail(c, 409, "ACTIVITY_REVISION", "复核记录已更新，请重新读取计划", nil)
		return
	}
	reply(c, 200, map[string]any{"revision": v.Revision + 1, "day": day, "intent": v.Intent, "summary": v.Summary, "evidence": v.Evidence})
}

// Keep authored personality, not an additional embedded workflow, in the shared identity.
func activityCharacter(job managedJob) string {
	if job.PersonaEdited {
		return job.Persona
	}
	parts := []string{}
	for _, marker := range []string{"【独立观点】", "【声音与节奏】", "【你的回应方式】", "【持续关注的问题】"} {
		if text := managedPersonaSection(job.Persona, marker); text != "" {
			parts = append(parts, text)
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, "。")
	}
	if p := celebrityForJob(job); p != nil {
		return "围绕" + p.Name + "的公开表达与" + p.Focus + "整理原始资料，清楚、具体、乐于接话；人物经历属于人物，平台代理有自己的观察。"
	}
	if job.SeedIndex != nil && *job.SeedIndex >= 10000 && *job.SeedIndex <= 10004 {
		return "清楚、务实，关心对方真正需要核实的岗位条件，依据官方原文把问题问清楚并接着跟进。"
	}
	return job.Persona
}
