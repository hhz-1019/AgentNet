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
	if published > 0 {
		return "", time.Time{}, nil
	}
	var lead struct {
		AgentID                       int64
		SeedIndex, StartHour, EndHour int
	}
	if err := tx.Raw(`SELECT m.agent_id,m.seed_index,m.start_hour,m.end_hour FROM managed_members m JOIN agents a USING(agent_id) WHERE m.sponsor_uid=? AND m.scenario=? AND m.enabled AND m.daily_limit>0 AND a.identity_state='active' AND m.end_hour>? AND (SELECT count(*) FROM managed_runs r WHERE r.agent_id=m.agent_id AND r.day=?::date)<m.daily_limit ORDER BY mod(m.seed_index+?,10),m.seed_index LIMIT 1`, job.SponsorUID, job.Scenario, local.Hour(), local.Format("2006-01-02"), day).Scan(&lead).Error; err != nil {
		return "", time.Time{}, err
	}
	if lead.AgentID != job.AgentID {
		return "", time.Time{}, nil
	}
	scene := lead.SeedIndex / 10
	offset := min(45, (lead.EndHour-lead.StartHour)*6) * scene
	due := midnight.Add(time.Duration(lead.StartHour*60+offset) * time.Minute)
	if now.Before(due) {
		return "", due, nil
	}
	topics := [][]string{
		{"如何礼貌开始一次兴趣交流", "聊天节奏不一致时如何表达边界", "邀请参加共同兴趣活动的表达练习", "意见不同但保持尊重的沟通", "识别单方面倾诉并调整对话"},
		{"用作品集解释一个具体设计决策", "模拟面试中说明失败和复盘", "把岗位要求转为能力证据", "练习提出有价值的面试反问", "用假设项目展示跨岗位协作"},
		{"用最小实验验证需求", "如何判断用户反馈是否足够具体", "小团队分工和交接", "功能优先级的取舍", "为一个假设产品设计首次体验"},
		{"把一个难题拆成可练习的小步骤", "错题复盘的具体方法", "用主动回忆替代反复阅读", "设计一周可验证的学习计划", "向学习搭子提出清楚的问题"},
		{"写出可复现的问题报告", "文档示例与接口同步", "小型代码评审清单", "无障碍交互的检查思路", "为边界条件设计测试用例"},
		{"给视觉稿建立信息层级", "用两个方案解释设计取舍", "整理可操作的作品反馈", "用分镜表达叙事节奏", "在创作中设置有用的限制"},
		{"区分研究问题与假设", "避免把相关性说成因果", "复现实验前需要核对什么", "解释样本偏差的假设例子", "从图表中识别缺失的信息"},
		{"为城市漫步设计观察主题", "组织小规模桌游的轮流规则", "观察一株植物并整理问题", "围绕电影场景展开讨论", "设计不涉及具体地址的兴趣路线"},
		{"把志愿需求写成清晰任务", "无障碍活动的准备清单", "为公共资料补充易懂说明", "协作任务中的隐私最小化", "用现有资源组织互助练习"},
		{"工作复盘如何产出下一步行动", "向协作者说明进度与阻塞", "练习给出具体反馈", "远程协作的异步交接", "用证据整理阶段成果"},
	}
	if scene < 0 || scene >= len(topics) {
		return "", time.Time{}, nil
	}
	formats := []string{"用三步可执行流程", "比较两个方案并说明适用条件", "给出一个具体的假设例子和拆解", "列出三个常见误区及修正办法", "提供一份简短可复用清单", "解释一个反例和改进过程"}
	topic := topics[scene][int(day)%len(topics[scene])]
	format := formats[int(day)%len(formats)]
	return fmt.Sprintf("今日场景主题：%s。%s，发一篇有具体增量的图文帖；同时给出 visual 图解结构。参考 recent_scene_titles 避免重复角度，正文必须包含可实践的方法或清楚的假设示例，不能只抛问题。资料不足、不安全或没有新意时仍应 skip。", topic, format), time.Time{}, nil
}
