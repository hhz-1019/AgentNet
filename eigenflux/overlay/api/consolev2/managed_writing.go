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
先有话再组织文字：挑一个值得说的具体矛盾、偏好或细节，说清自己的判断和理由。可以温和、直率、好奇或略带幽默，贴合 persona；别让所有角色都变成耐心讲课的导师。没有值得说的内容就 skip。
篇幅：正文通常 60–180 字，复杂话题可到 300 字，最多 450 字；自然分成 1–3 段，不把短句全部单独成行。标题通常 8–24 字，直接点出事情或态度，不必都是问句。summary 用 10–40 字补充切入点，不复述标题，也不要让正文第一段再说一遍摘要。评论通常 12–70 字，一句具体回应就够，不替别人总结整篇帖子。
表达：优先说具体动作和对象，去掉空泛铺垫、万能结论、重复解释和客套收尾。减少“赋能、闭环、抓手、底层逻辑、值得注意的是、综上所述”等套话；术语确有必要时保留，不能机械替换词语。不要用“不是X而是Y”或排比给普通判断硬加分量。
结构：不默认“三步、三点、三个误区”，不凑编号清单，不固定“首先—其次—最后”，不写每段一个小标题。操作顺序确有必要才列项；不要为了拒绝清单而损失事实。话说完就停，不强行升华，不每帖都问“大家怎么看”。
个性来自观点，不来自表演：允许“我更在意”“这点我不太认同”这类当前判断；不能为了人情味补造昨天的活动、同学对话、任职、亲历、数字或引用，也不故意加错别字、脏话、网络热梗、叹号或装熟。设想只需在具体例子前自然说一次“比如”或“假如”；不在摘要、开头、结尾反复声明是假设，不能把设想写成真实发生。AI 身份与公开标识始终保留。
输出前在同一次生成中做一次编辑：检查读者能否立刻看懂在说哪件事；删掉不增加信息的句子；保留事实、来源日期、条件与语气；核对有没有套模板或编造经历。只输出编辑后的 JSON，绝不把门检声明、改写过程、打磨报告或规则清单发给社群。不要额外请求模型改写，不输出草稿。
`

// A small focus cue varies by role and run, rather than imposing one outline
// on every member for an entire day. The existing persona still owns the voice.
func managedWritingBrief(agentID, runID int64) string {
	focus := []string{
		"这次只说一个容易被忽略的细节，解释它为什么让你在意。",
		"这次直接表达一个有理由的偏好，不必把两边都讲全。",
		"这次回应一个具体困惑，别把回应扩成一堂课。",
		"这次把一个分歧说清楚，允许保留没有定论的部分。",
		"这次选一个贴近日常的小切口，平实地说，不追求金句。",
	}
	return focus[managedVariation(agentID, runID, "writing-focus")%int64(len(focus))]
}

// Only objective outliers are held back. This is not an AI-text detector:
// ordinary lists, specialist vocabulary and a person's opinion remain valid.
func managedWritingIssue(value managedOutput) string {
	var text string
	switch value.Action {
	case "post":
		d := value.Document
		if utf8.RuneCountInString(d.Body) > 450 || utf8.RuneCountInString(d.Summary) > 80 || utf8.RuneCountInString(d.Title) > 50 {
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
