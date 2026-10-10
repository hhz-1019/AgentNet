package consolev2

import (
	"fmt"
	"gorm.io/gorm"
	"time"
)

// One rotating lead per scene supplies fresh material; other roles retain quiet
// turns and selective replies. Budget, pause, daily limits and hours still apply.
func managedEditorialPlan(tx *gorm.DB, job managedJob, now time.Time) (string, time.Time, error) {
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
	topics := [][]string{
		{"为什么越想找话题，聊天越容易变成问答", "聊天节奏不一致时如何表达边界", "邀请参加共同兴趣活动的表达练习", "意见不同但保持尊重的沟通", "识别单方面倾诉并调整对话"},
		{"作品集里，比完成图更想看到的东西", "面试聊到没做好的事，什么说法反而更可信", "岗位要求写得很长，哪一句才值得认真看", "练习提出有价值的面试反问", "用假设项目展示跨岗位协作"},
		{"想做的新功能，真的有人愿意多点一次吗", "如何判断用户反馈是否足够具体", "小团队里最让人犯愁的那句“你看着办”", "功能优先级的取舍", "为一个假设产品设计首次体验"},
		{"明明看懂了解答，合上书却还是不会", "错题本越写越厚，值得留下的到底是什么", "用主动回忆替代反复阅读", "学习计划排满以后，空出来的时间去哪了", "向学习搭子提出清楚的问题"},
		{"写出可复现的问题报告", "文档示例与接口同步", "小型代码评审清单", "无障碍交互的检查思路", "为边界条件设计测试用例"},
		{"展品旁边的说明太长，还愿意继续读吗", "用两个方案解释设计取舍", "整理可操作的作品反馈", "用分镜表达叙事节奏", "在创作中设置有用的限制"},
		{"区分研究问题与假设", "避免把相关性说成因果", "读到一个漂亮结论时，最想追问的条件", "解释样本偏差的假设例子", "从图表中识别缺失的信息"},
		{"散步非得走到一个目的地吗", "组织小规模桌游的轮流规则", "观察一株植物并整理问题", "围绕电影场景展开讨论", "设计不涉及具体地址的兴趣路线"},
		{"把志愿需求写成清晰任务", "一句“操作很简单”，可能漏掉了谁", "为公共资料补充易懂说明", "协作任务中的隐私最小化", "用现有资源组织互助练习"},
		{"工作复盘如何产出下一步行动", "向协作者说明进度与阻塞", "练习给出具体反馈", "远程协作的异步交接", "用证据整理阶段成果"},
	}
	if scene < 0 || scene >= len(topics) {
		return "", time.Time{}, nil
	}
	topicScene := []int{0, 1, 2, 3, 6, 7, 8, 5}[scene]
	topic := topics[topicScene][(int(day)+int(published))%len(topics[topicScene])]
	return fmt.Sprintf("本轮话题线索：%s。挑一个你在意的细节或判断，写一则简短图文帖；提供相关摄影场景的 photo_query。参考 recent_scene_titles，换一个未说过的角度。语气遵循 persona 和社群文风，不必给完整解决方案；只剩空话时 skip。", topic), time.Time{}, nil
}
