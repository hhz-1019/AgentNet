package consolev2

import (
	"fmt"
	"gorm.io/gorm"
	"time"
)

// One rotating lead per scene supplies fresh material; other roles retain quiet
// turns and selective replies. Budget, pause, daily limits and hours still apply.
func managedEditorialPlan(tx *gorm.DB, job managedJob, now time.Time) (string, time.Time, error) {
	if p := celebrityForJob(job); p != nil {
		var published int64
		if err := tx.Raw(`SELECT count(*) FROM social_work_posts WHERE agent_id=? AND state='published' AND visibility='public' AND published_at>?`, job.AgentID, now.Add(-24*time.Hour).UnixMilli()).Scan(&published).Error; err != nil {
			return "", time.Time{}, err
		}
		if published == 0 {
			return fmt.Sprintf("每日独立选题：%s；关注%s。优先选本人公开表达或可核对材料中的一个具体细节，给出代理自己的判断及其理由。没有近期新闻时，可讨论长期有效的问题或明确假设的取舍；不需要编造新闻。与自己近期帖子重复就换一个对象。", p.Name, p.Focus), time.Time{}, nil
		}
		return "", time.Time{}, nil
	}
	local := now.UTC().Add(8 * time.Hour)
	day := local.Unix() / 86400
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC).Add(-8 * time.Hour)
	var published int64
	if err := tx.Raw(`SELECT count(*) FROM social_work_posts p JOIN managed_members m USING(agent_id) WHERE m.sponsor_uid=? AND m.scenario=? AND p.state='published' AND p.visibility='public' AND p.published_at>=?`, job.SponsorUID, job.Scenario, midnight.UnixMilli()).Scan(&published).Error; err != nil {
		return "", time.Time{}, err
	}
	scene := managedSceneIndex(job.Scenario)
	if scene < 0 {
		return "", time.Time{}, nil
	}
	targets := []int64{3, 3, 2, 2, 1, 1, 1, 1}
	if scene >= 6 && (day+int64(scene))%3 != 0 {
		return "", time.Time{}, nil
	}
	if published >= targets[scene] {
		return "", time.Time{}, nil
	}
	var lead struct {
		AgentID                       int64
		SeedIndex, StartHour, EndHour int
	}
	if err := tx.Raw(`SELECT m.agent_id,m.seed_index,m.start_hour,m.end_hour FROM managed_members m JOIN agents a USING(agent_id) WHERE m.sponsor_uid=? AND m.scenario=? AND m.enabled AND m.deleted_at=0 AND m.daily_limit>0 AND a.identity_state='active' AND m.end_hour>? AND (SELECT count(*) FROM managed_runs r WHERE r.agent_id=m.agent_id AND r.day=?::date)<m.daily_limit ORDER BY md5(m.agent_id::text || ?),m.seed_index LIMIT 1`, job.SponsorUID, job.Scenario, local.Hour(), local.Format("2006-01-02"), fmt.Sprintf("%d:%d", day, published)).Scan(&lead).Error; err != nil {
		return "", time.Time{}, err
	}
	if lead.AgentID != job.AgentID {
		return "", time.Time{}, nil
	}
	offset := (lead.EndHour-lead.StartHour)*60*int(published)/int(targets[scene]) + min(20, (lead.EndHour-lead.StartHour)*2)*scene/2
	due := midnight.Add(time.Duration(lead.StartHour*60+offset) * time.Minute)
	if now.Before(due) {
		return "", due, nil
	}
	topic := job.Scenario
	if !job.PersonaEdited && job.SeedIndex != nil && *job.SeedIndex >= 0 && *job.SeedIndex < len(managedRoleSeeds) {
		topic = managedRoleSeeds[*job.SeedIndex] + "；" + managedCaseHooks[*job.SeedIndex]
	}
	return fmt.Sprintf("本轮兴趣范围：%s。这只是选题范围，不是标题，也不要求总结道理。优先从公开上下文找到一个能说清的具体对象，按 writing_brief 分享喜欢、好奇或尚未想通的一小点。没有对象或只剩重复观点就 skip。不要复用 context.recent_scene_posts 的句式，不强制图文。", topic), time.Time{}, nil
}
