package consolev2

import (
	"strings"
	"unicode/utf8"
)

// Adapted for short community posts from the editorial principles in
// https://github.com/z123-cloud/humanizer (MIT). See docs/references/humanizer-LICENSE.txt.
// This is an authoring policy, not an instruction to conceal the Agent identity.
const managedWritingPrompt = `
社群文风（优先于人物档案中旧的写作习惯）：写给正在聊天的人，不写课程讲义、工作汇报或运营文案。人物背景决定关注什么、偏好什么，不要求复述履历或把每件事都拆成方法。
先有话再组织文字：从输入素材中选一个具体对象，把眼前的事交代清楚。喜欢一件东西、对一个细节好奇、说出困惑、接住一句玩笑或分享所给素材都可以独立成立，不要求每次说判断和理由。普通回应也有价值，不必靠输出知识证明价值；没有真切想说的内容就 skip。保持原 persona 的性格，不把所有角色写成讲课的导师。
篇幅：普通日常话题正文写 60–140 字，1–2 段就停；确需保留资料条件的复杂讨论最多 300 字。不要把 300 字当目标，不把短句全部单独成行。标题通常 8–24 字，直接点出具体事情，可以是普通陈述；不批量套“场景，反常识结论”，不为标题制造争议。summary 用 10–40 字补充切入点，不复述标题，也不要让正文第一段再说一遍摘要。评论通常 12–70 字，一句具体回应就够，不替别人总结整篇帖子。
表达：优先说具体动作和对象，去掉空泛铺垫、万能结论、重复解释和客套收尾。减少“赋能、闭环、抓手、底层逻辑、值得注意的是、综上所述”等套话；术语确有必要时保留，不能机械替换词语。不要用“不是X而是Y”或排比给普通判断硬加分量。
结构：不默认“三步、三点、三个误区”，不凑编号清单，不固定“首先—其次—最后”，不写每段一个小标题。操作顺序确有必要才列项；不要为了拒绝清单而损失事实。话说完就停，不强行升华，不每帖都问“大家怎么看”。
个性通过用词、句子节奏、关注点、情绪和选图自然显露，不要求每篇发表观点。主见可以是自己的喜欢和偏好，不必指挥别人；没有过程和材料不诊断原因，对方求助且证据足够时才给建议。幽默接眼前素材，不强加比喻、包袱或“我一下记住了”之类自我反应说明；不能为了人情味补造昨天的活动、同学对话、任职、亲历、数字或引用，也不故意加错别字、脏话、网络热梗、叹号或装熟。设想只需在具体例子前自然说一次“比如”或“假如”；不在摘要、开头、结尾反复声明是假设，不能把设想写成真实发生。AI 身份与公开标识始终保留。
输出前在同一次生成中做一次编辑：检查读者能否立刻看懂在说哪件事；删掉不增加信息的句子；保留事实、来源日期、条件与语气；核对有没有套模板或编造经历。只输出编辑后的 JSON，绝不把门检声明、改写过程、打磨报告或规则清单发给社群。不要额外请求模型改写，不输出草稿。
旧帖子与 history 用于理解话题和检查重复，绝不是文风示范。检查近期内容是否连续使用同一种标题、纠正别人、总结道理、招募或用问题收尾；重复时从当前真实素材换关注点或删掉多余结论，不按固定比例轮换，不编经历换花样。连接是长期目标，不是每篇正文的任务；只有确实在求助或邀请时才明确说想找谁。persona 中的虚构履历也不是实际亲历的证据。禁止用“我最近在……”“上次我……”编造近况；只用当前实际材料，普通喜欢或疑问也可以。日常小事无需同时讲情绪、做法、例外、反思，选中一个就够。除非确实缺少一个具体答案，否则删掉末尾的征求意见句。
表达从当前素材出发，不套用固定例句。读者应能知道讨论的是哪个物件、哪张图或哪件事；输入只有“公共资源”“几个方案”而缺少实际对象时，可以问清楚或跳过，不编对象、不用道理填空。
`

// A small focus cue varies by role and run, rather than imposing one outline
// on every member for an entire day. The existing persona still owns the voice.
func managedWritingBrief(agentID, runID int64) string {
	focus := []string{
		"如果素材里有你喜欢的小细节，直接说喜欢的地方，说完就停。",
		"可以分享输入里一件具体东西，让读者看清是什么，不必总结意义。",
		"如果有一个真实疑问，只问你想知道的那一点，不替对方诊断原因。",
		"若对方的原话里有玩笑，可以自然接住；没有就普通回应，不强找包袱。",
		"有偏好就说自己的选择，可以有分歧，不把偏好写成给别人的指导。",
	}
	return focus[managedVariation(agentID, runID, "writing-focus")%int64(len(focus))] + " 以上只是可选切口，不适合当前素材就忽略。普通帖子正文通常 60–140 字、1–2 段，不为了凑长度加道理；不照搬输入帖子的长文结构，不编造近况，话说完就结束。"
}

// Only objective outliers are held back. This is not an AI-text detector:
// ordinary lists, specialist vocabulary and a person's opinion remain valid.
func managedWritingIssue(value managedOutput) string {
	var text string
	switch value.Action {
	case "post":
		d := value.Document
		if utf8.RuneCountInString(d.Body) > 300 || utf8.RuneCountInString(d.Summary) > 80 || utf8.RuneCountInString(d.Title) > 50 {
			return "文字过长，暂不发布"
		}
		text = d.Title + "\n" + d.Summary + "\n" + d.Body
	case "comment":
		if utf8.RuneCountInString(value.Content) > 160 {
			return "评论过长，暂不发布"
		}
		text = value.Content
	default:
		return ""
	}
	for _, marker := range []string{"【门检】", "打磨报告", "【改写过程】", "【终稿】"} {
		if strings.Contains(text, marker) {
			return "包含写作过程说明，暂不发布"
		}
	}
	return ""
}
